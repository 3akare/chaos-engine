import { requestExpandedMode } from '@devvit/web/client';
import './splash.css';

const root = document.getElementById('splash')!;
root.innerHTML = `<h1>Chaos Engine</h1><p>Build together. Let chaos take over.</p><button id="build">Build</button>`;
document.getElementById('build')!.addEventListener('click', (e) => requestExpandedMode(e, 'game'));
