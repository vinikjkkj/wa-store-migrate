// End-to-end live test for the whatsmeow side of wa-store-migrate.
//
// Reads `.auth/whatsmeow-dump.json` (produced by `examples/baileys-to-whatsmeow.ts`),
// builds a fresh `*store.Device` populated with the migrated material, saves
// it through whatsmeow's sqlstore container, and finally launches the client
// to connect to WhatsApp.
//
//	go run .
//
// The sqlite database is written next to the runner at `.auth/whatsmeow.db`.
// Auto-exits after WHATSMEOW_EXIT_MS (defaults to 30000); set 0 to keep
// running until you Ctrl+C.
package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"go.mau.fi/whatsmeow/util/keys"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

type dumpKeyPair struct {
	Pub  string `json:"pub"`
	Priv string `json:"priv"`
}

type dumpSignedPreKey struct {
	KeyID     uint32 `json:"keyId"`
	Pub       string `json:"pub"`
	Priv      string `json:"priv"`
	Signature string `json:"signature"`
}

type dumpAccount struct {
	Details             string `json:"details"`
	AccountSignatureKey string `json:"accountSignatureKey"`
	AccountSignature    string `json:"accountSignature"`
	DeviceSignature     string `json:"deviceSignature"`
}

type dumpDevice struct {
	RegistrationID  uint32           `json:"registrationId"`
	NoiseKeyPub     string           `json:"noiseKeyPub"`
	NoiseKeyPriv    string           `json:"noiseKeyPriv"`
	IdentityKeyPub  string           `json:"identityKeyPub"`
	IdentityKeyPriv string           `json:"identityKeyPriv"`
	SignedPreKey    dumpSignedPreKey `json:"signedPreKey"`
	AdvSecretKey    string           `json:"advSecretKey"`
	Account         *dumpAccount     `json:"account"`
	MeJid           string           `json:"meJid"`
	MeLid           string           `json:"meLid"`
	Platform        string           `json:"platform"`
	PushName        string           `json:"pushName"`
}

type dumpPreKey struct {
	KeyID    uint32 `json:"keyId"`
	Pub      string `json:"pub"`
	Priv     string `json:"priv"`
	Uploaded bool   `json:"uploaded"`
}

type dumpIdentity struct {
	Addr        string `json:"addr"`
	IdentityKey string `json:"identityKey"`
}

type dumpSession struct {
	Addr    string `json:"addr"`
	Session string `json:"session"`
}

type dumpSenderKey struct {
	GroupID    string `json:"groupId"`
	SenderAddr string `json:"senderAddr"`
	Record     string `json:"record"`
}

type dumpAppStateSyncKey struct {
	KeyID       string `json:"keyId"`
	KeyData     string `json:"keyData"`
	Timestamp   int64  `json:"timestamp"`
	Fingerprint string `json:"fingerprint"`
}

type dumpAppStateVersion struct {
	Collection string `json:"collection"`
	Version    uint64 `json:"version"`
	Hash       string `json:"hash"`
}

type dumpAppStateMutationMac struct {
	Collection string `json:"collection"`
	Version    uint64 `json:"version"`
	IndexMac   string `json:"indexMac"`
	ValueMac   string `json:"valueMac"`
}

type dumpPrivacyToken struct {
	UserJid    string `json:"userJid"`
	Token      string `json:"token"`
	TimestampS int64  `json:"timestampS"`
}

type dump struct {
	Device               dumpDevice                `json:"device"`
	PreKeys              []dumpPreKey              `json:"preKeys"`
	Identities           []dumpIdentity            `json:"identities"`
	Sessions             []dumpSession             `json:"sessions"`
	SenderKeys           []dumpSenderKey           `json:"senderKeys"`
	AppStateSyncKeys     []dumpAppStateSyncKey     `json:"appStateSyncKeys"`
	AppStateVersions     []dumpAppStateVersion     `json:"appStateVersions"`
	AppStateMutationMacs []dumpAppStateMutationMac `json:"appStateMutationMacs"`
	PrivacyTokens        []dumpPrivacyToken        `json:"privacyTokens"`
}

func decode(b64 string) []byte {
	if b64 == "" {
		return nil
	}
	out, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		panic(fmt.Sprintf("base64 decode: %v", err))
	}
	return out
}

func decodeArr32(b64 string) *[32]byte {
	b := decode(b64)
	if len(b) == 32 {
		var arr [32]byte
		copy(arr[:], b)
		return &arr
	}
	if len(b) == 33 && b[0] == 0x05 {
		// strip libsignal type prefix
		var arr [32]byte
		copy(arr[:], b[1:])
		return &arr
	}
	panic(fmt.Sprintf("expected 32 or 33-byte (with 0x05 prefix), got %d", len(b)))
}

func decodeArr64(b64 string) *[64]byte {
	b := decode(b64)
	if len(b) != 64 {
		panic(fmt.Sprintf("expected 64-byte signature, got %d", len(b)))
	}
	var arr [64]byte
	copy(arr[:], b)
	return &arr
}

func decodeArrFixed32(b64 string) [32]byte {
	b := decode(b64)
	var arr [32]byte
	if len(b) == 32 {
		copy(arr[:], b)
		return arr
	}
	if len(b) == 33 && b[0] == 0x05 {
		copy(arr[:], b[1:])
		return arr
	}
	panic(fmt.Sprintf("expected 32 or 33-byte, got %d", len(b)))
}

func decodeArr128(b64 string) [128]byte {
	b := decode(b64)
	if len(b) != 128 {
		panic(fmt.Sprintf("expected 128-byte LT-hash, got %d", len(b)))
	}
	var arr [128]byte
	copy(arr[:], b)
	return arr
}

func parseJID(s string) (types.JID, error) {
	if s == "" {
		return types.EmptyJID, nil
	}
	return types.ParseJID(s)
}

func main() {
	exitMs := 30000
	if v := os.Getenv("WHATSMEOW_EXIT_MS"); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil {
			exitMs = n
		}
	}

	dumpPath, err := filepath.Abs(filepath.Join("..", "..", ".auth", "whatsmeow-dump.json"))
	if err != nil {
		panic(err)
	}
	dbPath, err := filepath.Abs(filepath.Join("..", "..", ".auth", "whatsmeow.db"))
	if err != nil {
		panic(err)
	}

	fmt.Printf("[step 1] reading dump from %s\n", dumpPath)
	data, err := os.ReadFile(dumpPath)
	if err != nil {
		panic(err)
	}
	var d dump
	if err := json.Unmarshal(data, &d); err != nil {
		panic(err)
	}
	fmt.Printf("[step 1] ✓ regId=%d meJid=%s meLid=%s preKeys=%d sessions=%d senderKeys=%d\n",
		d.Device.RegistrationID, d.Device.MeJid, d.Device.MeLid,
		len(d.PreKeys), len(d.Sessions), len(d.SenderKeys))

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		panic(err)
	}
	if os.Getenv("WHATSMEOW_RESET") == "1" {
		_ = os.Remove(dbPath)
	}

	logger := waLog.Stdout("Main", "INFO", true)
	dbLogger := waLog.Stdout("DB", "WARN", true)

	fmt.Printf("[step 2] opening sqlite + sqlstore container at %s\n", dbPath)
	ctx := context.Background()
	rawDB, err := sql.Open("sqlite3", "file:"+dbPath+"?_foreign_keys=on")
	if err != nil {
		panic(err)
	}
	defer rawDB.Close()
	container := sqlstore.NewWithDB(rawDB, "sqlite3", dbLogger)
	if err := container.Upgrade(ctx); err != nil {
		panic(err)
	}

	fmt.Printf("[step 3] populating *store.Device from dump\n")
	device := container.NewDevice()

	device.RegistrationID = d.Device.RegistrationID
	device.NoiseKey = &keys.KeyPair{
		Pub:  decodeArr32(d.Device.NoiseKeyPub),
		Priv: decodeArr32(d.Device.NoiseKeyPriv),
	}
	device.IdentityKey = &keys.KeyPair{
		Pub:  decodeArr32(d.Device.IdentityKeyPub),
		Priv: decodeArr32(d.Device.IdentityKeyPriv),
	}
	device.SignedPreKey = &keys.PreKey{
		KeyPair: keys.KeyPair{
			Pub:  decodeArr32(d.Device.SignedPreKey.Pub),
			Priv: decodeArr32(d.Device.SignedPreKey.Priv),
		},
		KeyID:     d.Device.SignedPreKey.KeyID,
		Signature: decodeArr64(d.Device.SignedPreKey.Signature),
	}
	device.AdvSecretKey = decode(d.Device.AdvSecretKey)

	if d.Device.Account != nil {
		device.Account = &waProto.ADVSignedDeviceIdentity{
			Details:             decode(d.Device.Account.Details),
			AccountSignatureKey: decode(d.Device.Account.AccountSignatureKey),
			AccountSignature:    decode(d.Device.Account.AccountSignature),
			DeviceSignature:     decode(d.Device.Account.DeviceSignature),
		}
		// silence unused-import warning if proto isn't directly referenced
		_ = proto.Marshal
	}

	if d.Device.MeJid != "" {
		jid, err := parseJID(d.Device.MeJid)
		if err != nil {
			panic(err)
		}
		device.ID = &jid
	}
	if d.Device.MeLid != "" {
		lid, err := parseJID(d.Device.MeLid)
		if err != nil {
			panic(err)
		}
		device.LID = lid
	}
	device.Platform = d.Device.Platform
	device.PushName = d.Device.PushName
	device.FacebookUUID = uuid.Nil
	device.Initialized = true

	fmt.Printf("[step 4] saving device → container\n")
	if err := device.Save(ctx); err != nil {
		panic(err)
	}

	// Container.NewDevice() returns a Device without per-domain stores wired up;
	// those are only attached when the Container loads a device via GetDevice.
	// Re-fetch so device.Identities, .Sessions, etc. are non-nil before we
	// start populating them.
	if device.ID != nil {
		loaded, err := container.GetDevice(ctx, *device.ID)
		if err != nil {
			panic(err)
		}
		if loaded == nil {
			panic("GetDevice returned nil for our just-saved JID")
		}
		device = loaded
	}

	fmt.Printf("[step 5] writing %d preKeys, %d identities, %d sessions, %d senderKeys, %d appStateSyncKeys, %d appStateVersions\n",
		len(d.PreKeys), len(d.Identities), len(d.Sessions), len(d.SenderKeys), len(d.AppStateSyncKeys), len(d.AppStateVersions))

	// preKeys: whatsmeow's public PreKeyStore can't insert at an arbitrary
	// keyId, so we INSERT directly into `whatsmeow_pre_keys` via the same DB
	// handle the container is using.
	for _, pk := range d.PreKeys {
		insertPreKey(rawDB, device.ID, pk)
	}

	for _, id := range d.Identities {
		key32 := decodeArrFixed32(id.IdentityKey)
		if err := device.Identities.PutIdentity(ctx, id.Addr, key32); err != nil {
			fmt.Printf("    putIdentity %s: %v\n", id.Addr, err)
		}
	}

	for _, s := range d.Sessions {
		if err := device.Sessions.PutSession(ctx, s.Addr, decode(s.Session)); err != nil {
			fmt.Printf("    putSession %s: %v\n", s.Addr, err)
		}
	}

	for _, sk := range d.SenderKeys {
		if err := device.SenderKeys.PutSenderKey(ctx, sk.GroupID, sk.SenderAddr, decode(sk.Record)); err != nil {
			fmt.Printf("    putSenderKey %s/%s: %v\n", sk.GroupID, sk.SenderAddr, err)
		}
	}

	for _, k := range d.AppStateSyncKeys {
		entry := store.AppStateSyncKey{
			Data:        decode(k.KeyData),
			Fingerprint: decode(k.Fingerprint),
			Timestamp:   k.Timestamp,
		}
		if err := device.AppStateKeys.PutAppStateSyncKey(ctx, decode(k.KeyID), entry); err != nil {
			fmt.Printf("    putAppStateSyncKey: %v\n", err)
		}
	}

	for _, v := range d.AppStateVersions {
		hash := decodeArr128(v.Hash)
		if err := device.AppState.PutAppStateVersion(ctx, v.Collection, v.Version, hash); err != nil {
			fmt.Printf("    putAppStateVersion %s: %v\n", v.Collection, err)
		}
	}

	if len(d.AppStateMutationMacs) > 0 {
		byColl := map[string][]store.AppStateMutationMAC{}
		ver := map[string]uint64{}
		for _, m := range d.AppStateMutationMacs {
			byColl[m.Collection] = append(byColl[m.Collection], store.AppStateMutationMAC{
				IndexMAC: decode(m.IndexMac),
				ValueMAC: decode(m.ValueMac),
			})
			if m.Version > ver[m.Collection] {
				ver[m.Collection] = m.Version
			}
		}
		for collection, macs := range byColl {
			if err := device.AppState.PutAppStateMutationMACs(ctx, collection, ver[collection], macs); err != nil {
				fmt.Printf("    putAppStateMutationMACs %s: %v\n", collection, err)
			}
		}
	}

	fmt.Printf("[step 6] launching whatsmeow.Client.Connect()\n")
	client := whatsmeow.NewClient(device, logger)
	client.AddEventHandler(func(evt any) {
		switch e := evt.(type) {
		case *events.Connected:
			fmt.Printf("[event] CONNECTED\n")
		case *events.LoggedOut:
			fmt.Printf("[event] LOGGED OUT reason=%v onConnect=%v\n", e.Reason, e.OnConnect)
		case *events.Disconnected:
			fmt.Printf("[event] DISCONNECTED\n")
		case *events.Message:
			text := ""
			if msg := e.Message; msg != nil {
				if c := msg.GetConversation(); c != "" {
					text = c
				} else if t := msg.GetExtendedTextMessage().GetText(); t != "" {
					text = t
				}
			}
			fmt.Printf("[message] from=%s chat=%s text=%q\n", e.Info.Sender, e.Info.Chat, text)
		case *events.OfflineSyncCompleted:
			fmt.Printf("[event] OFFLINE_SYNC_COMPLETED count=%d\n", e.Count)
		}
	})

	if err := client.Connect(); err != nil {
		panic(err)
	}

	if exitMs > 0 {
		fmt.Printf("[main] running %d ms…\n", exitMs)
		select {
		case <-time.After(time.Duration(exitMs) * time.Millisecond):
		case <-waitForSignal():
		}
	} else {
		<-waitForSignal()
	}

	fmt.Printf("[main] disconnecting\n")
	client.Disconnect()
}

func waitForSignal() chan os.Signal {
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	return c
}

// insertPreKey writes a single PreKey to the sqlstore via raw SQL, marking it
// uploaded if the dump says so. whatsmeow's public PreKeyStore doesn't expose
// a put for an arbitrary keyId, so we hit the schema (`whatsmeow_pre_keys`)
// directly. The schema is: jid, key_id, key (priv), uploaded.
func insertPreKey(db *sql.DB, deviceJID *types.JID, pk dumpPreKey) {
	priv := decode(pk.Priv)
	pub := decode(pk.Pub)
	if len(priv) != 32 || len(pub) != 32 {
		fmt.Printf("    preKey %d skipped: bad key length\n", pk.KeyID)
		return
	}
	jidStr := ""
	if deviceJID != nil {
		jidStr = deviceJID.String()
	}
	_, err := db.ExecContext(context.Background(),
		`INSERT OR REPLACE INTO whatsmeow_pre_keys (jid, key_id, key, uploaded) VALUES (?, ?, ?, ?)`,
		jidStr, pk.KeyID, priv, pk.Uploaded,
	)
	if err != nil {
		fmt.Printf("    preKey %d insert failed: %v\n", pk.KeyID, err)
	}
}
