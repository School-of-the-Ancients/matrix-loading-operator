# Stylized professor models

Six original, texture-free VRM 1.0 avatars generated from geometric shapes by
`Tools/generate_professor_avatars.mjs`. They use this repository's MIT license.
No external model, character scan, purchased asset or Riko geometry was reused.
The VRM metadata includes the VRM public license and links the project license.

These are deliberately simplified human representations, not historical portraits:

| Model | Useful visual traits | Curated examples |
| --- | --- | --- |
| Renaissance scholar | Long gray beard, burgundy robe and cap | Leonardo, Galileo |
| Classical philosopher | Short beard, pale robe | Socrates, Plato, Aristotle, Euclid, Archimedes |
| Classical woman scholar | Dark hair, teal robe | Hypatia |
| Victorian woman scholar | Updo, green gown and pale collar | Ada Lovelace, Mary Somerville |
| Natural philosopher | Long pale hair, dark coat | Newton, Leibniz, Descartes |
| Modern scientist | White hair, moustache, suit | Einstein, Planck |

All use the same humanoid hierarchy, movable fingers and eyes, mouth opening and
blink morph targets. `catalog.json` pins the generated SHA-256s and matching tags.
Only those exact registered bytes qualify for automatic matching. Unknown/imported
models remain manual choices. Each file is below 600 KB; the catalog tests load
every model and check voice morphs and pointing. Quest wearer performance is still
a separate acceptance step.

To regenerate and install locally:

```powershell
node Tools/generate_professor_avatars.mjs
python Tools/install_professor_avatars.py --catalog .utmp/professor-local/assets
```

Run the commands from the repository root. The local Professor launcher also
registers the bundled models before starting. Registration is content-addressed
and does not alter existing model bytes or worlds.
