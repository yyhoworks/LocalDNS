# Mihomo host bypass and return rule guard

An optional OpenRC integration for the existing VM gateway design. LocalDNS
does not require this service on ordinary installations.

This integration expects the existing, root-owned `/etc/init.d/mihomo-return`,
`/etc/conf.d/mihomo-return`, `/usr/local/sbin/mihomo-ipv6` and
`/etc/conf.d/mihomo-ipv6` scripts. It uses their configured interface, gateways,
IPv6 TProxy port and existing marks/tables. It is not a generic firewall manager.

`guard.py --check` inspects the actual firewall and policy routing without
changing them. `--ensure --wait 15` restores missing IPv4/IPv6 rules through the
existing scripts, then verifies the resulting state. A shared lock serializes
the reload hook and background recovery. Healthy rules are not rewritten.
Missing/incomplete Mihomo core chains are treated as not ready; the guard does
not create them or restart the core.

`openrc` runs the guard every two seconds under `supervise-daemon`. Only health
transitions, repairs and rate-limited errors are logged. The existing proxy
configuration service uses `post-reload-mihomo.sh` for synchronous validation.
Direct API reloads that bypass that hook are covered by the periodic guard;
there can be a brief recovery interval after such a reload.

## Installation on a matching VM

Back up the current firewall, policy routes, scripts and reload hook first.
Prepare a scoped rollback that preserves unrelated firewall changes. Validate
the existing scripts and run `guard.py --check` before installation.

Install `guard.py` as `/usr/local/sbin/mihomo-return-guard.py`, `openrc` as
`/etc/init.d/mihomo-return-guard`, and the hook at the already configured
`postReload` path. All three should be root-owned and mode `0750`. Run the hook,
enable the guard with `rc-update add mihomo-return-guard default`, then start
it with `rc-service mihomo-return-guard start`.

Verify each domestic DNS resolver, explicit foreign SOCKS5/DoH/ECS paths,
LAN proxy traffic, IPv6 and a controlled configuration reload. Service status
alone is not a firewall health check. Stop the guard before intentionally
changing this VM's bypass/return design.
