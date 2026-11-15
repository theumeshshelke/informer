# Fake-Shell test

Runs the real `extension.js` and `sources.js` against stand-ins for GNOME Shell (no desktop needed).

    node --import ./tests/harness/register.mjs tests/harness/run.mjs

(Run from the repo root. Needs Node 22.7 or newer.)

- `run.mjs` is the scenario list: add a block for each new feature. It moves a fake clock, fakes
  `/sys` files (`__fs.files`, `__fs.dirs`) and command output (`__fs.run`), fires the 1 s heartbeat, and checks the messages.
- Settings come from the real schema file, so a missing or wrong-type key throws.
- The last lines check that `disable()` leaves no timers and no settings handlers.
- `fake-util.mjs` is `util.js` with a fake file system. If you change the helpers in `util.js`, copy them over.
- It cannot check how things look. Test that on a real desktop.
