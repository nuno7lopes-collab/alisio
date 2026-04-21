---
summary: "Run Alisio in a sandboxed macOS VM (local or hosted) when you need isolation or iMessage"
read_when:
  - You want Alisio isolated from your main macOS environment
  - You want iMessage integration (BlueBubbles) in a sandbox
  - You want a resettable macOS environment you can clone
  - You want to compare local vs hosted macOS VM options
title: "macOS VMs"
---

# Alisio on macOS VMs (Sandboxing)

## Recommended default (most users)

- **Small Linux VPS** for an always-on Gateway and low cost. See [VPS hosting](/vps).
- **Dedicated hardware** (Mac mini or Linux box) if you want full control and a **residential IP** for `computer use` or other UI automation. Many sites block data center IPs, so local browsing often works better.
- **Hybrid:** keep the Gateway on a cheap VPS, and connect your Mac as a **node** when you need `computer use` or other UI automation. See [Nodes](/nodes) and [Gateway remote](/gateway/remote).

Use a macOS VM when you specifically need macOS-only capabilities (iMessage/BlueBubbles) or want strict isolation from your daily Mac.

## macOS VM options

### Local VM on your Apple Silicon Mac

Run Alisio in a sandboxed macOS VM on your existing Apple Silicon Mac using a third-party Apple Silicon macOS VM CLI.

This gives you:

- Full macOS environment in isolation (your host stays clean)
- iMessage support via BlueBubbles (impossible on Linux/Windows)
- Instant reset by cloning VMs
- No extra hardware or cloud costs

### Hosted Mac providers (cloud)

If you want macOS in the cloud, hosted Mac providers work too:

- [MacStadium](https://www.macstadium.com/) (hosted Macs)
- Other hosted Mac vendors also work; follow their VM + SSH docs

Once you have SSH access to a macOS VM, continue at step 6 below.

---

## Quick path (experienced users)

1. Install your preferred macOS VM CLI
2. `<vm-cli> create alisio --os macos --ipsw latest`
3. Complete Setup Assistant, enable Remote Login (SSH)
4. `<vm-cli> run alisio --no-display`
5. SSH in, install Alisio, configure channels
6. Done

---

## What you need

- Apple Silicon Mac (M1/M2/M3/M4)
- macOS Sequoia or later on the host
- ~60 GB free disk space per VM
- ~20 minutes

---

## 1) Install your macOS VM CLI

Follow your VM provider's installation guide for its Apple Silicon macOS CLI.

If `~/.local/bin` isn't in your PATH:

```bash
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.zshrc && source ~/.zshrc
```

Verify:

```bash
<vm-cli> --version
```

Tip: verify that your CLI can create, clone, stop, and run named macOS VMs before continuing.

---

## 2) Create the macOS VM

```bash
<vm-cli> create alisio --os macos --ipsw latest
```

This downloads macOS and creates the VM. A VNC window opens automatically.

Note: The download can take a while depending on your connection.

---

## 3) Complete Setup Assistant

In the VNC window:

1. Select language and region
2. Skip Apple ID (or sign in if you want iMessage later)
3. Create a user account (remember the username and password)
4. Skip all optional features

After setup completes, enable SSH:

1. Open System Settings → General → Sharing
2. Enable "Remote Login"

---

## 4) Get the VM IP address

```bash
<vm-cli> get alisio
```

Look for the IP address (usually `192.168.64.x`).

---

## 5) SSH into the VM

```bash
ssh youruser@192.168.64.X
```

Replace `youruser` with the account you created, and the IP with your VM's IP.

---

## 6) Install Alisio

Inside the VM:

```bash
npm install -g alisio@npm:alisio@latest
alisio onboard --install-daemon
```

Follow the onboarding prompts to set up your model provider (Anthropic, OpenAI, etc.).

---

## 7) Configure channels

Edit the config file:

```bash
nano ~/.alisio/alisio.json
```

Add your channels:

```json5
{
  channels: {
    whatsapp: {
      dmPolicy: "allowlist",
      allowFrom: ["+15551234567"],
    },
    telegram: {
      botToken: "YOUR_BOT_TOKEN",
    },
  },
}
```

Then login to WhatsApp (scan QR):

```bash
alisio channels login
```

---

## 8) Run the VM headlessly

Stop the VM and restart without display:

```bash
<vm-cli> stop alisio
<vm-cli> run alisio --no-display
```

The VM runs in the background. Alisio's daemon keeps the gateway running.

To check status:

```bash
ssh youruser@192.168.64.X "alisio status"
```

---

## Bonus: iMessage integration

This is the killer feature of running on macOS. Use [BlueBubbles](https://bluebubbles.app) to add iMessage to Alisio.

Inside the VM:

1. Download BlueBubbles from bluebubbles.app
2. Sign in with your Apple ID
3. Enable the Web API and set a password
4. Point BlueBubbles webhooks at your gateway (example: `https://your-gateway-host:3000/bluebubbles-webhook?password=<password>`)

Add to your Alisio config:

```json5
{
  channels: {
    bluebubbles: {
      serverUrl: "http://localhost:1234",
      password: "your-api-password",
      webhookPath: "/bluebubbles-webhook",
    },
  },
}
```

Restart the gateway. Now your agent can send and receive iMessages.

Full setup details: [BlueBubbles channel](/channels/bluebubbles)

---

## Save a golden image

Before customizing further, snapshot your clean state:

```bash
<vm-cli> stop alisio
<vm-cli> clone alisio alisio-golden
```

Reset anytime:

```bash
<vm-cli> stop alisio && <vm-cli> delete alisio
<vm-cli> clone alisio-golden alisio
<vm-cli> run alisio --no-display
```

---

## Running 24/7

Keep the VM running by:

- Keeping your Mac plugged in
- Disabling sleep in System Settings → Energy Saver
- Using `caffeinate` if needed

For true always-on, consider a dedicated Mac mini or a small VPS. See [VPS hosting](/vps).

---

## Troubleshooting

| Problem                  | Solution                                                                         |
| ------------------------ | -------------------------------------------------------------------------------- |
| Can't SSH into VM        | Check "Remote Login" is enabled in VM's System Settings                          |
| VM IP not showing        | Wait for VM to fully boot, run `<vm-cli> get alisio` again                       |
| VM CLI command not found | Add your CLI install path to `PATH`                                              |
| WhatsApp QR not scanning | Ensure you're logged into the VM (not host) when running `alisio channels login` |

---

## Related docs

- [VPS hosting](/vps)
- [Nodes](/nodes)
- [Gateway remote](/gateway/remote)
- [BlueBubbles channel](/channels/bluebubbles)
- [Docker Sandboxing](/install/docker) (alternative isolation approach)
