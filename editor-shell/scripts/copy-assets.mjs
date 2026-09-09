import { copyFile, mkdir } from 'node:fs/promises';

const destination = new URL('../dist/advanced-authoring/', import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(new URL('../src/advanced-authoring/advanced-authoring.css', import.meta.url), new URL('advanced-authoring.css', destination));
