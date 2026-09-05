import { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Image, Layers, LayoutGrid, MoreHorizontal, Plus, Users } from 'lucide-react';
import { LoadingState, Skeleton, PageTransition, Button, Checkbox, Dialog, EmptyState, IconButton, NavigationMenu, PasswordField, SelectField, StatusBadge, Tabs, TextAreaField, TextField, WorkflowSteps, type SelectFieldProps } from '../src';
import '../src/styles.css';
import './preview.css';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="specimen"><div className="section-heading"><span>{id}</span><h2>{title}</h2></div><div className="section-content">{children}</div></section>;
}

function Preview() {
  const [title, setTitle] = useState('雨后的城市');
  const [saved, setSaved] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [model, setModel] = useState<SelectFieldProps['value']>('wan');
  const [section, setSection] = useState('overview');
  const [step, setStep] = useState(1);
  const [transition, setTransition] = useState(0);
  return (
    <main className="preview-shell">
      <header className="preview-header"><a href="#" className="wordmark">OMNISTUDIO <span>/ UI</span></a><span className="edition">V3 · 组件预览</span></header>
      <div className="intro"><p className="eyebrow">COMPONENT LIBRARY</p><h1>创作，从细节开始。</h1><p>浏览组件状态，试用表单、选择与对话框。</p></div>
      <nav aria-label="组件分类" className="preview-nav"><a href="#01">操作</a><a href="#02">表单</a><a href="#03">选择与状态</a><a href="#04">内容切换</a><a href="#05">对话框</a></nav>
      <Section id="01" title="操作按钮">
        <div className="sample-row"><Button onPress={() => setDialogOpen(true)}><Plus size={16} />新建项目</Button><Button variant="secondary" onPress={() => setSaved(true)}>保存草稿</Button><Button variant="quiet" onPress={() => document.getElementById('02')?.scrollIntoView()}>继续编辑<ArrowRight size={16} /></Button><Button variant="danger" isDisabled>删除项目</Button><IconButton aria-label="项目操作" onPress={() => setDialogOpen(true)}><MoreHorizontal size={16} /></IconButton></div>
        <div className="sample-row"><Button isPending>生成中</Button><Button isDisabled>生成视频</Button><Button size="sm" variant="secondary">小尺寸</Button><Button size="lg" variant="secondary">大尺寸</Button></div>
        <p role="status" className="sample-message">{saved ? '草稿已保存（预览）' : '\u00a0'}</p>
      </Section>
      <Section id="02" title="文本与表单">
        <div className="field-grid">
          <TextField label="项目名称" value={title} onChange={setTitle} isRequired description="为这个故事起一个名字。" />
          <TextField label="邮箱" type="email" placeholder="you@example.com" autoComplete="email" />
          <PasswordField label="密码" autoComplete="new-password" showPasswordLabel="显示密码" hidePasswordLabel="隐藏密码" description="至少 8 个字符。" minLength={8} />
          <TextField label="项目名称" defaultValue="" isInvalid errorMessage="请输入项目名称。" />
          <TextField label="素材编号" value="AST-0248" isDisabled description="素材编号由系统生成。" />
          <TextAreaField label="故事梗概" placeholder="深夜，一封迟到的信改变了他的计划……" maxLength={1000} />
        </div>
      </Section>
      <Section id="03" title="选择与状态">
        <div className="field-grid"><SelectField label="生成模型" value={model} onChange={setModel} options={[{ id: 'wan', label: '通义万相', description: '视频生成' }, { id: 'kling', label: '可灵', description: '视频生成' }, { id: 'vidu', label: 'Vidu', description: '视频生成' }]} /><div className="checkbox-stack"><Checkbox defaultSelected>保留原始素材</Checkbox><Checkbox>完成后通知我</Checkbox><Checkbox isDisabled>自动归档</Checkbox></div></div>
        <div className="sample-row status-row"><StatusBadge>草稿</StatusBadge><StatusBadge tone="info">排队中</StatusBadge><StatusBadge tone="warning">生成中</StatusBadge><StatusBadge tone="success">已完成</StatusBadge><StatusBadge tone="danger">生成失败</StatusBadge></div>
      </Section>
      <Section id="04" title="内容切换"><Tabs aria-label="素材类型" items={[{id:'character',label:'角色',content:<p>角色素材 · 3 个角色</p>},{id:'scene',label:'场景',content:<p>场景素材 · 2 个场景</p>},{id:'prop',label:'道具',content:<p>道具素材 · 暂无道具</p>}]} /></Section>
      <Section id="05" title="对话框"><div className="sample-row"><Button variant="secondary" onPress={() => setDialogOpen(true)}>编辑项目信息</Button><span className="sample-note">Esc 关闭 · Tab 切换焦点</span></div></Section>
      <Section id="06" title="导航与流程">
        <NavigationMenu aria-label="工作区导航" currentId={section} onNavigate={href => setSection(href.slice(1))} items={[{id:'overview',label:'总览',href:'#overview',icon:<LayoutGrid size={16} />},{id:'shared',label:'与我共享',href:'#shared',icon:<Users size={16} />},{id:'series',label:'系列',href:'#series',icon:<Layers size={16} />},{id:'assets',label:'素材库',href:'#assets',icon:<Image size={16} />}]} />
        <div className="workflow-sample"><WorkflowSteps aria-label="制作流程" currentStep={step} onStepChange={setStep} steps={[{id:'script',title:'剧本'},{id:'storyboard',title:'分镜'},{id:'assets',title:'素材'},{id:'export',title:'导出'}]} /></div>
      </Section>
      <Section id="07" title="空状态"><EmptyState title="还没有项目" description="创建第一个项目，开始讲述你的故事。" action={<Button onPress={() => setDialogOpen(true)}><Plus size={16} />新建项目</Button>} /></Section>
      <Section id="08" title="加载与页面切换">
        <LoadingState label="正在加载项目…" inline />
        <div aria-busy="true" aria-label="项目加载中" className="field-grid"><Skeleton style={{ height: 120, borderRadius: 12 }} /><div><Skeleton style={{ height: 20, marginBottom: 12 }} /><Skeleton style={{ height: 20, width: '70%' }} /></div></div>
        <Button variant="secondary" onPress={() => setTransition(value => value + 1)}>重新播放页面过渡</Button>
        <PageTransition transitionKey={String(transition)}><p>继续创作 · 项目已就绪</p></PageTransition>
      </Section>
      <Dialog title="编辑项目信息" closeLabel="关闭对话框" isOpen={dialogOpen} onOpenChange={setDialogOpen} footer={<><Button slot="close" variant="secondary">取消</Button><Button onPress={() => { setSaved(true); setDialogOpen(false); }}>保存</Button></>}><TextField label="项目名称" value={title} onChange={setTitle} /><TextAreaField label="故事梗概" placeholder="讲述你的故事……" /></Dialog>
      <footer className="preview-footer">OMNISTUDIO <span>Render Noise into Narrative</span></footer>
    </main>
  );
}

document.documentElement.classList.add('omni-ui');
createRoot(document.getElementById('root')!).render(<Preview />);
