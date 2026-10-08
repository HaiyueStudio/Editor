import { TUTORIAL_CHAPTERS, TUTORIAL_STAGES, TUTORIAL_REFERENCES, findTutorial, searchTutorials } from './tutorialContent.js';
import { TUTORIAL_LABS, tutorialProject } from './tutorialLabs.js';
import { tutorialDiff } from './tutorialDiff.js';
import { WgslPreview } from './codeEditor.js';
import { PASS_LABELS, type ShaderProject, type Channel, type ShaderPass } from './model.js';
import { builtinTexture } from './builtinTextures.js';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const item = document.createElement(tag); item.className = className; item.textContent = text; return item;
}
function channelName(channel: Channel) {
  if (channel.kind==='builtin') return builtinTexture(channel.texture).name;
  if (channel.kind==='buffer') return PASS_LABELS[channel.pass];
  if (channel.kind==='keyboard') return '键盘';
  return channel.kind==='none' ? '未绑定' : channel.kind;
}
export class TutorialPage {
  private current = TUTORIAL_CHAPTERS[0]!;
  private preview: WgslPreview | undefined;
  private article = document.getElementById('tutorial-article')!;
  private outline = document.getElementById('tutorial-outline')!;
  private search = document.getElementById('tutorial-search') as HTMLInputElement;
  private counter = document.getElementById('tutorial-results')!;
  constructor(private navigate: (id: string) => void, private open: (project: ShaderProject) => void) {
    const facts = document.querySelectorAll('.tutorial-facts strong');
    [TUTORIAL_CHAPTERS.length,TUTORIAL_STAGES.length,TUTORIAL_LABS.length].forEach((count,i)=>{
      if (facts[i]) facts[i]!.textContent = String(count);
    });
    const stages = document.getElementById('tutorial-stages')!;
    TUTORIAL_STAGES.forEach((stage, i) => {
      const chapters = TUTORIAL_CHAPTERS.filter(chapter=>chapter.stage===i);
      const first = TUTORIAL_CHAPTERS.indexOf(chapters[0]!) + 1;
      const link = this.link(chapters[0]!.id, ''); link.className = 'tutorial-stage';
      link.append(element('small', '', '0' + (i + 1) + ' / ' + String(first).padStart(2, '0') + '—' + String(first+chapters.length-1).padStart(2, '0')),
        element('strong', '', stage.title), element('span', '', stage.description));
      stages.append(link);
    });
    this.search.addEventListener('input', () => this.renderOutline()); this.renderOutline();
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
      const chapters = found.filter(chapter => chapter.stage === stageIndex); if (!chapters.length) return;
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
    const lab = TUTORIAL_LABS.find(item=>item.id===chapter.id)!;
    this.article.replaceChildren();
    const heading = element('h2', '', chapter.title); heading.id = 'tutorial-title'; heading.tabIndex = -1;
    this.article.append(element('p', 'eyebrow', 'CHAPTER ' + String(index + 1).padStart(2, '0') + ' / '+TUTORIAL_CHAPTERS.length+' · ' + stage.title),
      heading, element('p', 'tutorial-goal', chapter.goal));
    const prerequisite = lab.baseId ? this.link(lab.baseId,'基于练习：'+findTutorial(lab.baseId).title)
      : element('p', 'muted', '起点：会打开编辑器即可，无需三维建模经验。');
    prerequisite.classList.add('tutorial-prerequisite'); this.article.append(prerequisite);
    const change = element('aside','tutorial-change'); change.append(element('strong','','本章新增'),element('p','',chapter.change));
    this.article.append(change,element('h3', '', '理解原理'), element('p', '', chapter.intro), element('p', '', chapter.detail));
    const steps = element('ol','tutorial-steps');
    for (const step of chapter.steps) { const item=element('li');item.append(element('h4','',step.title),element('p','',step.body));steps.append(item); }
    this.article.append(element('h3','','一步步实现'),steps);
    const formula = element('pre', 'tutorial-formula'); formula.append(element('code', '', chapter.formula));
    this.article.append(element('h3', '', '核心公式'), formula);
    const pitfall = element('aside', 'tutorial-pitfall'); pitfall.append(element('strong', '', '容易混淆'), element('p', '', chapter.pitfall));
    this.article.append(pitfall,element('h3','','只改一个参数'));
    const experiment=element('div','tutorial-experiment');
    const values=[['参数',chapter.experiment.parameter],['当前值',chapter.experiment.before],['尝试改为',chapter.experiment.after],['预期变化',chapter.experiment.expected]];
    const dl=element('dl'); for (const [label,value] of values) dl.append(element('dt','',label),element('dd','',value));experiment.append(dl);
    const task = element('section', 'tutorial-exercise'); task.append(element('h3', '', '继续挑战'), element('p', '', chapter.exercise));
    this.article.append(experiment,task);
    const labHeader = element('div', 'tutorial-lab-header'), label = element('div');
    label.append(element('h3', '', '本章完整工程'),element('p', 'muted', '已实现本章步骤。点击保存后才加入我的作品。'));
    const launch = element('button', 'primary compact', '打开练习 · 新草稿 ↗');
    launch.id = 'tutorial-open-lab'; launch.onclick = () => this.open(tutorialProject(lab.id));
    labHeader.append(label, launch);
    this.article.append(labHeader,element('p','tutorial-expected','运行后应该看到：'+chapter.expected));
    const project=tutorialProject(lab.id), base=lab.baseId ? tutorialProject(lab.baseId) : undefined;
    const tabs=element('div','tutorial-pass-tabs'); tabs.setAttribute('role','group');tabs.setAttribute('aria-label','示例渲染通道');
    const bindings=element('p','tutorial-bindings muted');
    const diff=element('details','tutorial-diff'), summary=element('summary','',lab.baseId ? '查看相对「'+findTutorial(lab.baseId).title+'」的代码变化' : '查看本章新增代码');
    const diffCode=element('pre'); diffCode.tabIndex=0;
    diff.append(summary,element('p','muted','＋ 新增　− 删除　未标记的行是保留内容'),diffCode);
    const code=element('div','tutorial-code');code.id='tutorial-code';
    this.article.append(tabs,bindings,diff,code);
    this.preview=new WgslPreview(code,'本章完整 WGSL 代码');
    const buttons: {pass:ShaderPass;button:HTMLButtonElement}[]=[];
    const showPass=(pass:ShaderPass)=>{
      for (const item of buttons) { const selected=item.pass.id===pass.id;item.button.classList.toggle('active',selected);item.button.setAttribute('aria-pressed',String(selected)); }
      const connected=pass.channels.map((channel,i)=>channel.kind==='none' ? '' : 'iChannel'+i+' → '+channelName(channel)).filter(Boolean);
      bindings.textContent=connected.length ? connected.join('　·　') : '本 Pass 无需纹理输入。';
      const previous=base?.passes.find(item=>item.id===pass.id && item.enabled)?.code ?? '';
      diffCode.replaceChildren();
      for (const line of tutorialDiff(previous,pass.code)) diffCode.append(element('span','tutorial-diff-'+line.kind,(line.kind==='added'?'+ ':line.kind==='removed'?'- ':'  ')+line.text+'\n'));
      this.preview!.show(pass.code);this.preview!.view.requestMeasure();
    };
    for (const pass of project.passes.filter(pass=>pass.enabled)) {
      const button=element('button','compact',PASS_LABELS[pass.id]);button.onclick=()=>showPass(pass);tabs.append(button);buttons.push({pass,button});
    }
    showPass(project.passes.find(pass=>pass.id==='image')!);
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
  }
  dispose() { this.preview?.destroy(); }
}
