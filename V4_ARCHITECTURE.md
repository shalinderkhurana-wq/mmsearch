# MEDIMANCH Research Navigator V4 Architecture

## What changed from V3
V3 treated live feeds as the source of the hierarchy. V4 separates the layers.

### MAP ENGINE
LLM builds Flagship → Territory → Sub-category → Cluster. This is the navigation map and is stored client-side for reuse.

### SIGNAL ENGINE
Live YouTube/Reddit/News discovery runs only for the selected node. It does not create the tree directly.

### CONCEPT ENGINE
The LLM interprets selected-node signals into human tension, BIC mapping, viral angles, visual concepts and final titles.

### NAVIGATION UI
Persistent left tree, central selected-node research, right path + saved shortlist. Research Again and Go Deeper preserve the selected node.

## Why this is closer to the MEDIMANCH specification
The original research model calls for a clickable hierarchy, breadcrumbs, saved choices and deep live scanning only after a node is selected. V4 implements those as first-class controls rather than using feed clustering as the product logic.
