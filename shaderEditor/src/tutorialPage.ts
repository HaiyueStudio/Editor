import { TUTORIAL_CHAPTERS, TUTORIAL_STAGES, TUTORIAL_REFERENCES, findTutorial, searchTutorials } from './tutorialContent.js';
import { TUTORIAL_LABS, tutorialProject } from './tutorialLabs.js';
import { WgslPreview } from './codeEditor.js';
import type { ShaderProject } from './model.js';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const item = document.createElement(tag); item.className = className; item.textContent = text; return item;
}
export class TutorialPage {
  private current = TUTORIAL_CHAPTERS[0]!;
  private preview: WgslPreview | undefined;
  private article = document.getElementById('tutorial-article')!;
  private outline = document.getElementById('tutorial-outline')!;
  private search = document.getElementById('tutorial-search') as HTMLInputElement;
  private counter = document.getElementById('tutorial-results')!;
  constructor(private navigate: (id: string) => void, private open: (project: ShaderProject) => void) {
    const stages = document.getElementById('tutorial-stages')!;
    TUTORIAL_STAGES.forEach((stage, i) => {
      const link = this.link(TUTORIAL_CHAPTERS[i * 4]!.id, '');
      link.className = 'tutorial-stage';
      link.append(element('small', '', '0' + (i + 1) + ' / ' + String(i * 4 + 1).padStart(2, '0') + '—' + String(i * 4 + 4).padStart(2, '0')),
        element('strong', '', stage.title), element('span', '', stage.description));
      stages.append(link);
    });
    this.search.addEventListener('input', () => this.renderOutline());
    this.renderOutline();
  }
  get currentId() { return this.current.id; }
  private link(id: string, text: string) {
    const link = element('a', '', text); link.href = '#tutorial/' + id;
    link.onclick = event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); this.navigate(id); } };
    return link;
  }
  private renderOutline() {
    const found = searchTutorials(this.search.value);
    this.counter.textContent = found.length + ' / ' + TUTORIAL_CHAPTERS.length + ' 章';
    this.outline.replaceChildren();
    TUTORIAL_STAGES.forEach((stage, stageIndex) => {
      const chapters = found.filter(chapter => chapter.stage === stageIndex);
      if (!chapters.length) return;
      const section = element('section'); section.append(element('h3', '', '0' + (stageIndex + 1) + ' · ' + stage.title));
      for (const chapter of chapters) {
        const index = TUTORIAL_CHAPTERS.indexOf(chapter);
        const link = this.link(chapter.id, String(index + 1).padStart(2, '0') + '  ' + chapter.title);
        if (chapter.id === this.current.id) link.setAttribute('aria-current', 'page');
        section.append(link);
      }
      this.outline.append(section);
    });
    if (!found.length) this.outline.append(element('p', 'muted', '没有匹配章节，试试“圆”“距离”“IQ”或“Ray”。'));
  }
  show(id: string) {
    this.current = findTutorial(id); this.renderOutline(); this.preview?.destroy(); this.preview = undefined;
    const chapter = this.current, index = TUTORIAL_CHAPTERS.indexOf(chapter), stage = TUTORIAL_STAGES[chapter.stage]!;
    this.article.replaceChildren();
    const heading = element('h2', '', chapter.title); heading.id = 'tutorial-title'; heading.tabIndex = -1;
    this.article.append(element('p', 'eyebrow', 'CHAPTER ' + String(index + 1).padStart(2, '0') + ' / 32 · ' + stage.title),
      heading, element('p', 'tutorial-goal', chapter.goal));
    const prerequisite = index === 0 ? element('p', 'muted', '起点：会打开编辑器即可，无需三维建模经验。')
      : this.link(TUTORIAL_CHAPTERS[index - 1]!.id, '建议先读：' + TUTORIAL_CHAPTERS[index - 1]!.title);
    prerequisite.classList.add('tutorial-prerequisite'); this.article.append(prerequisite);
    this.article.append(element('h3', '', '理解原理'), element('p', '', chapter.intro), element('p', '', chapter.detail));
    const formula = element('pre', 'tutorial-formula'); formula.append(element('code', '', chapter.formula));
    this.article.append(element('h3', '', '核心公式'), formula);
    const pitfall = element('aside', 'tutorial-pitfall'); pitfall.append(element('strong', '', '容易混淆'), element('p', '', chapter.pitfall));
    const task = element('section', 'tutorial-exercise'); task.append(element('h3', '', '动手练习'), element('p', '', chapter.exercise));
    this.article.append(pitfall, task);
    const lab = TUTORIAL_LABS.find(lab => lab.id === stage.lab)!;
    const labHeader = element('div', 'tutorial-lab-header');
    const label = element('div'); label.append(element('h3', '', '本阶段示例 · ' + lab.title),
      element('p', 'muted', '可运行的起点工程；按照本章练习继续修改。点击保存后才加入我的作品。'));
    const launch = element('button', 'primary compact', '打开练习 · 新草稿 ↗');
    launch.id = 'tutorial-open-lab'; launch.onclick = () => this.open(tutorialProject(lab.id));
    labHeader.append(label, launch); this.article.append(labHeader);
    const code = element('div', 'tutorial-code'); code.id = 'tutorial-code'; this.article.append(code);
    this.preview = new WgslPreview(code, '教程示例 WGSL 代码'); this.preview.show(lab.code);
    if (lab.id === 'feedback') this.article.append(element('p', 'muted', '这里显示 Image 代码；打开练习后还包含已连接的 Buffer A。'));
    if (chapter.references.length) {
      const references = element('ul', 'tutorial-references');
      for (const id of chapter.references) {
        const source = TUTORIAL_REFERENCES[id]!, item = element('li'), link = element('a', '', source.title + ' ↗');
        link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        item.append(link, element('small', '', source.author)); references.append(item);
      }
      this.article.append(element('h3', '', '延伸阅读 · 作者原文'), references);
    }
    const nav = element('nav', 'tutorial-pagination'); nav.setAttribute('aria-label', '章节导航');
    if (index > 0) nav.append(this.link(TUTORIAL_CHAPTERS[index - 1]!.id, '← ' + TUTORIAL_CHAPTERS[index - 1]!.title));
    if (index + 1 < TUTORIAL_CHAPTERS.length) nav.append(this.link(TUTORIAL_CHAPTERS[index + 1]!.id, TUTORIAL_CHAPTERS[index + 1]!.title + ' →'));
    this.article.append(nav);
    this.preview.view.requestMeasure();
  }
  dispose() { this.preview?.destroy(); }
}
