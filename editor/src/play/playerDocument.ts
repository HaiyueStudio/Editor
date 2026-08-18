export function createPlayerDocument(baseUrl = window.location.href): string {
  const baseHref = escapeHtmlAttribute(new URL('./', baseUrl).href);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <base href="${baseHref}" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #05070b;
      color: #d8e2f2;
      font: 12px system-ui, sans-serif;
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
      background: #05070b;
      touch-action: none;
    }
    #message {
      position: absolute;
      left: 12px;
      bottom: 12px;
      padding: 8px 10px;
      border: 1px solid #303746;
      border-radius: 4px;
      background: rgba(16, 20, 28, 0.86);
      display: none;
    }
  </style>
</head>
<body>
  <canvas id="player-canvas"></canvas>
  <div id="message"></div>
  <script type="module" src="./dist/player.js"></script>
</body>
</html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
