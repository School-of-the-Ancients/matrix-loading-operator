# Project-map compatibility pointer

The old multi-track project map has been replaced by a simpler ownership model.

See [ARCHITECTURE.md](ARCHITECTURE.md).

## Ownership

- **Matrix:** shared world runtime, Operator, creation/presentation, generic WebXR/room AR, physics and world persistence.
- **School of the Ancients / Cosmos Fair:** independent historical-figure conversations, mentor identities, teaching, curriculum and learner records; uses Matrix for supported presentation material.
- **Civilization:** independent AI residents/society, Boulder and geographic AR overlay data/meaning; uses Matrix for bounded world execution.
- **Manfred:** human/wearable/private-context layer.
- **Unity:** archived historical Matrix implementation.

These are logical responsibilities. Current Citizens code remains nested in this repository. School can use a generic Matrix guide/avatar without depending on the Citizens simulation.

GitHub issues record implementation work. They are not a second definition of the product.
