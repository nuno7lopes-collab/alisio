# Alisio Windows Host

Native Windows frontend for the account-rooted Alisio product flow.

This app now exposes a native Windows workspace:

- gateway and runtime state render honestly
- stored sessions and JSONL transcripts render natively
- reconnect and setup-required states stay explicit
- auth, onboarding, and device binding stay attached to the canonical gateway contract

What this host is **not**:

- not a Windows-only auth model
- not a compatibility dashboard
- not a staged browser shell
- not a local `computer` runtime
- not a hidden embedded shell as the main UI

## Build from a Windows machine

```powershell
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/build.ps1
```

Or:

```powershell
dotnet build apps/windows/Alisio.WindowsHost.sln
```
