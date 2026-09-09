# @haiyue/editor-shell

Browser contribution hosts, shortcut routing and controlled UI adapters for Editor Platform products.

The `@haiyue/editor-shell/advanced-authoring` subpath exposes version 1 of the
controlled advanced authoring presentation API. Import the companion stylesheet
from `@haiyue/editor-shell/advanced-authoring.css`. The root entry remains unchanged;
the panel implementation loads dynamically only when `mountAdvancedAuthoring` runs.

The host supplies immutable document, selection, history and runtime projections,
validates dispatched intents, and owns authoring transactions and viewport previews.
Abort or dispose releases the panel and its gestures; no product store, Engine World,
filesystem, model provider or Agent implementation is part of this package boundary.
