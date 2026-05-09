---
name: shipping-and-launch
description: Prepare go/no-go release decisions with verification and rollback. Use for /addy-ship.
---

# Shipping and Launch

Before GO:

1. Confirm tests/build/review status.
2. Check security and performance risks.
3. Check docs, config, migrations, env vars, monitoring.
4. Identify blockers and accepted risks.
5. Write rollback trigger, rollback steps, and recovery target.

Default to NO-GO on unresolved Critical findings unless user accepts risk.
