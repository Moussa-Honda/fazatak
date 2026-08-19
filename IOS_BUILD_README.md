# Unsigned iOS IPA build

The `Build unsigned iOS IPA` GitHub Actions workflow builds the Capacitor iOS
application without an Apple certificate or provisioning profile. No GitHub
Secrets are required.

Run the workflow manually from **Actions > Build unsigned iOS IPA > Run
workflow**. When it completes, download the
`Fazatak-unsigned-iOS-<run number>` artifact. It contains
`Fazatak-unsigned.ipa`.

The generated IPA is unsigned. It cannot be installed directly on an iPhone;
it must first be signed with a valid Apple certificate and provisioning profile
using an external signing service or another signing workflow.
