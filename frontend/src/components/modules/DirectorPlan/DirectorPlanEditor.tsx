"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, Save, Sparkles } from "lucide-react";
import { Button, TextAreaField, TextField } from "@omnistudio/ui";
import { directorPlanApi, type DirectorPlan, type DirectorPlanScope } from "@/lib/api";

const FIELDS: Array<{ key: keyof DirectorPlan; label: string; multiline?: boolean }> = [
  { key: "tempo", label: "节奏" },
  { key: "composition", label: "构图" },
  { key: "lens", label: "焦段" },
  { key: "blocking", label: "调度", multiline: true },
  { key: "lighting", label: "灯光", multiline: true },
  { key: "transition", label: "转场" },
  { key: "sound", label: "声音", multiline: true },
];

const DEFAULT_PLAN: DirectorPlan = {
  tempo: "balanced", composition: "natural", lens: "35mm", blocking: "clear subject separation",
  lighting: "motivated soft light", transition: "cut", sound: "diegetic room tone", continuity_rules: [],
};

export default function DirectorPlanEditor({ projectId, episodeId = projectId, shotId }: { projectId: string; episodeId?: string; shotId?: string }) {
  const [scope, setScope] = useState<DirectorPlanScope>("episode");
  const [plan, setPlan] = useState<DirectorPlan>(DEFAULT_PLAN);
  const [sourceChain, setSourceChain] = useState<Record<string, string>>({});
  const [finalPrompt, setFinalPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<{ id: string; payload: DirectorPlan } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const targetId = scope === "project" ? projectId : scope === "episode" ? episodeId : shotId;
  const load = async () => {
    setBusy(true);
    try {
      const resolved = await directorPlanApi.resolve(episodeId, shotId);
      setPlan(resolved.plan);
      setSourceChain(resolved.source_chain);
      setFinalPrompt(resolved.prompt || "");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载导演计划失败");
    } finally { setBusy(false); }
  };

  useEffect(() => { void load(); }, [episodeId, shotId]);

  const update = (key: keyof DirectorPlan, value: string) => setPlan((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setBusy(true);
    try {
      const payload = Object.fromEntries(FIELDS.map(({ key }) => [key, plan[key]]));
      if (!targetId || (scope === "shot" && !shotId)) throw new Error("请选择要覆盖的镜头");
      await directorPlanApi.update(scope, targetId, scope === "shot" ? { ...payload, episode_id: episodeId } : payload);
      await load();
      setMessage("导演计划已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try {
      if (!targetId || (scope === "shot" && !shotId)) throw new Error("请选择要恢复的镜头");
      await directorPlanApi.remove(scope, targetId, scope === "shot" ? episodeId : undefined); await load(); setMessage("已恢复默认"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "恢复失败"); } finally { setBusy(false); }
  };
  const createPreview = async () => {
    if (!instruction.trim()) return;
    setBusy(true);
    try {
      if (!targetId || (scope === "shot" && !shotId)) throw new Error("请选择要预览的镜头");
      const result = await directorPlanApi.preview(scope, targetId, instruction); setPreview({ id: result.preview_id, payload: result.payload }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "预览失败"); } finally { setBusy(false); }
  };
  const confirmPreview = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      if (!targetId || (scope === "shot" && !shotId)) throw new Error("请选择要应用的镜头");
      await directorPlanApi.confirm(scope, targetId, preview.id); setPreview(null); await load(); setMessage("AI 导演计划已确认"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "确认失败"); } finally { setBusy(false); }
  };

  const sourceLabel = useMemo(() => (key: keyof DirectorPlan) => sourceChain[key] || "system", [sourceChain]);

  return <section aria-label="导演计划" className="mt-6 rounded-xl border border-glass-border bg-surface/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold text-foreground">导演计划</h2><p className="text-xs text-text-muted">逐层继承节奏、构图、焦段、调度、灯光、转场与声音规则</p></div>
      <div className="flex gap-2" role="group" aria-label="计划作用域">
        {(["project", "episode", "shot"] as DirectorPlanScope[]).map((value) => <Button key={value} variant={scope === value ? "primary" : "quiet"} isDisabled={value === "shot" && !shotId} onPress={() => setScope(value)}>{value === "project" ? "Project 基线" : value === "episode" ? "Episode 覆盖" : "Shot 覆盖"}</Button>)}
      </div>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {FIELDS.map(({ key, label, multiline }) => multiline
        ? <TextAreaField key={key} label={`${label} · ${sourceLabel(key)}`} value={String(plan[key] ?? "")} onChange={(value) => update(key, value)} rows={2} />
        : <TextField key={key} label={`${label} · ${sourceLabel(key)}`} value={String(plan[key] ?? "")} onChange={(value) => update(key, value)} />)}
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="primary" onPress={() => void save()} isPending={busy}><Save size={14} />保存计划</Button>
      <Button variant="quiet" onPress={() => void reset()} isDisabled={busy}><RotateCcw size={14} />恢复默认</Button>
    </div>
    <div className="mt-5 border-t border-glass-border pt-4">
      <TextAreaField label="AI 计划预览" value={instruction} onChange={setInstruction} placeholder="描述你希望的节奏、镜头和灯光变化" rows={2} />
      <div className="mt-2 flex gap-2"><Button variant="secondary" onPress={() => void createPreview()} isPending={busy} isDisabled={!instruction.trim()}><Sparkles size={14} />生成预览</Button>
        {preview && <Button variant="primary" onPress={() => void confirmPreview()} isDisabled={busy}><Check size={14} />确认并应用</Button>}</div>
      {preview && <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/20 p-3 text-xs text-text-secondary">{JSON.stringify(preview.payload, null, 2)}</pre>}
    </div>
    {message && <p role="status" className="mt-3 text-xs text-text-secondary">{message}</p>}
    <div className="mt-5 border-t border-glass-border pt-4" data-testid="director-plan-prompt-provenance">
      <h3 className="text-xs font-semibold text-foreground">最终提示词与来源链</h3>
      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs text-text-secondary">{finalPrompt || "保存计划后生成最终提示词"}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-muted">
        {FIELDS.map(({ key, label }) => <span key={key}>{label}: {sourceLabel(key)}</span>)}
      </div>
    </div>
  </section>;
}
