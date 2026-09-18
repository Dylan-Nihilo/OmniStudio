"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown, Clapperboard, RotateCcw, Save } from "lucide-react";
import { Button } from "@omnistudio/ui";
import { useTranslations } from "next-intl";
import { directorPlanApi, type DirectorPlan, type DirectorPlanScope } from "@/lib/api";
import styles from "./DirectorPlanEditor.module.css";

type Field = Exclude<keyof DirectorPlan, "continuity_rules">;
type Props = { projectId: string; episodeId?: string; shotId?: string };
const FIELDS: Field[] = ["tempo", "composition", "blocking", "lighting", "sound", "lens", "transition"];
const OPTIONS: Record<Field, Array<[string, string]>> = {
  tempo: [["measured", "measured"], ["balanced", "balanced"], ["urgent", "urgent"]],
  composition: [["natural", "natural"], ["centered", "centered composition"], ["opposed", "opposing subjects on either side of the frame"]],
  blocking: [["clear", "clear subject separation"], ["still", "restrained movement and expressive gestures"], ["dynamic", "dynamic action with readable movement"]],
  lighting: [["soft", "motivated soft light"], ["night", "cool night light with readable faces"], ["contrast", "high contrast directional lighting"]],
  sound: [["ambient", "diegetic room tone"], ["dialogue", "clear dialogue over restrained ambience"], ["action", "distinct action sounds and environmental ambience"]],
  lens: [["wide", "24mm"], ["natural", "35mm"], ["portrait", "85mm"]],
  transition: [["cut", "cut"], ["dissolve", "dissolve"], ["match", "match cut"]],
};
const LIMITS: Record<Field, number> = { tempo: 120, composition: 240, lens: 80, blocking: 500, lighting: 500, transition: 160, sound: 500 };
const DEFAULT_PLAN: DirectorPlan = {
  tempo: "balanced", composition: "natural", lens: "35mm", blocking: "clear subject separation",
  lighting: "motivated soft light", transition: "cut", sound: "diegetic room tone", continuity_rules: [],
};

export default function DirectorPlanEditor({ projectId, episodeId = projectId, shotId }: Props) {
  const t = useTranslations("directorPlan");
  return <details className={styles.panel}>
    <summary className={styles.summary}>
      <Clapperboard size={19} aria-hidden="true" />
      <span className={styles.heading}><strong>{t("title")}</strong><span>{t("subtitle")}</span></span>
      <span className={styles.optional}>{t("optional")}</span>
      <ChevronDown className={styles.chevron} size={17} aria-hidden="true" />
    </summary>
    <DirectorPlanForm key={`${projectId}:${episodeId}:${shotId || ""}`} projectId={projectId} episodeId={episodeId} shotId={shotId} />
  </details>;
}

function DirectorPlanForm({ projectId, episodeId = projectId, shotId }: Props) {
  const t = useTranslations("directorPlan");
  const uid = useId();
  const [scope, setScope] = useState<DirectorPlanScope>(shotId ? "shot" : "episode");
  const [plan, setPlan] = useState<DirectorPlan>(DEFAULT_PLAN);
  const [saved, setSaved] = useState<DirectorPlan>(DEFAULT_PLAN);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const targetId = scope === "project" ? projectId : scope === "episode" ? episodeId : shotId!;
  const changes = Object.fromEntries(FIELDS.filter(key => plan[key] !== saved[key]).map(key => [key, plan[key]]));
  const dirty = Object.keys(changes).length > 0;
  const invalid = FIELDS.some(key => !plan[key].trim() || plan[key].length > LIMITS[key]);
  const hasOverrides = Object.values(sources).includes(scope);
  const scopes: DirectorPlanScope[] = [...(projectId !== episodeId ? ["project" as const] : []), "episode", ...(shotId ? ["shot" as const] : [])];

  const read = useCallback(async () => {
    if (scope === "project") {
      const result = await directorPlanApi.get(scope, projectId);
      return { plan: { ...DEFAULT_PLAN, ...result.payload }, source_chain: Object.fromEntries(Object.keys(result.payload).map(key => [key, "project"])) };
    }
    return directorPlanApi.resolve(episodeId, scope === "shot" ? shotId : undefined);
  }, [scope, projectId, episodeId, shotId]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setLoaded(false); setError(""); setMessage("");
    read().then(result => {
      if (cancelled) return;
      setPlan(result.plan); setSaved(result.plan); setSources(result.source_chain); setLoaded(true);
    }).catch(() => { if (!cancelled) setError("loadFailed"); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [read, retry]);

  const save = async () => {
    if (busy || !loaded || !dirty || invalid) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await directorPlanApi.update(scope, targetId, scope === "shot" ? { ...changes, episode_id: episodeId } : changes);
      setSaved(plan);
      setSources(current => ({ ...current, ...Object.fromEntries(Object.keys(changes).map(key => [key, scope])) }));
      setMessage("saved");
    } catch { setError("saveFailed"); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      await directorPlanApi.remove(scope, targetId, scope === "shot" ? episodeId : undefined);
    } catch { setError("resetFailed"); setBusy(false); return; }
    try {
      const result = await read();
      setPlan(result.plan); setSaved(result.plan); setSources(result.source_chain); setMessage("resetDone");
    } catch { setLoaded(false); setError("reloadAfterReset"); }
    finally { setBusy(false); }
  };

  const renderField = (key: Field) => {
    const option = OPTIONS[key].find(([, value]) => value === plan[key]);
    const custom = !option;
    const hint = `${uid}-${key}-hint`;
    return <fieldset key={key} className={styles.field} disabled={busy || !loaded}>
      <legend>{t(`fields.${key}.label`)}</legend>
      <p className={styles.description}>{t(`fields.${key}.description`)}</p>
      <div className={styles.choices}>
        {[...OPTIONS[key], ["custom", ""]].map(([id, value]) => <label key={id} className={styles.choice}>
          <input type="radio" name={`${uid}-${key}`} value={id} checked={id === "custom" ? custom : plan[key] === value}
            aria-describedby={hint} onChange={() => { setPlan(current => ({ ...current, [key]: value })); setMessage(""); }} />
          <span>{id === "custom" ? t("custom") : t(`options.${key}.${id}.label`)}</span>
        </label>)}
      </div>
      <p id={hint} className={styles.hint}>{custom ? t("customHint") : t(`options.${key}.${option[0]}.hint`)}</p>
      {custom && <textarea className={styles.custom} aria-label={t("customLabel", { field: t(`fields.${key}.label`) })}
        placeholder={t(`fields.${key}.example`)} value={plan[key]} maxLength={LIMITS[key]} rows={2}
        aria-invalid={!plan[key].trim()} onChange={event => { setPlan(current => ({ ...current, [key]: event.target.value })); setMessage(""); }} />}
    </fieldset>;
  };

  return <div className={styles.body} aria-busy={busy}>
    <p className={styles.notice}>{t("noteOnly")}</p>
    <div className={styles.scope}>
      <span>{t("scopeLabel")}</span>
      {scopes.length === 1 ? <strong>{t(`scope.${scope}`)}</strong> : <div role="group" aria-label={t("scopeLabel")}>
        {scopes.map(value => <Button key={value} variant={scope === value ? "secondary" : "quiet"} aria-pressed={scope === value}
          isDisabled={busy || dirty} onPress={() => setScope(value)}>{t(`scope.${value}`)}</Button>)}
      </div>}
      {dirty && scopes.length > 1 && <span className={styles.hint}>{t("scopeDirty")}</span>}
    </div>
    {!loaded && <div role="status" className={styles.feedback}>{busy ? t("loading") : <Button variant="secondary" onPress={() => setRetry(value => value + 1)}>{t("retry")}</Button>}</div>}
    {loaded && <>
      <div className={styles.fields}>{FIELDS.slice(0, 5).map(renderField)}</div>
      <details className={styles.advanced}>
        <summary>{t("advanced")}<ChevronDown size={15} aria-hidden="true" /></summary>
        <p className={styles.hint}>{t("advancedHint")}</p>
        <div className={styles.fields}>{FIELDS.slice(5).map(renderField)}</div>
      </details>
      <footer className={styles.footer}>
        <span role="status">{message ? t(message) : (dirty ? t("unsaved") : t("savedState"))}</span>
        <div className={styles.actions}>
          {dirty && <Button variant="quiet" isDisabled={busy} onPress={() => { setPlan(saved); setMessage(""); setError(""); }}>{t("undo")}</Button>}
          <Button variant="quiet" isDisabled={busy || !hasOverrides || dirty} onPress={() => void reset()}><RotateCcw size={14} />{t("reset")}</Button>
          <Button variant="primary" isPending={busy} isDisabled={!dirty || invalid || busy} onPress={() => void save()}><Save size={14} />{t("save")}</Button>
        </div>
      </footer>
    </>}
    {error && <p role="alert" className={styles.error}>{t(error)}</p>}
  </div>;
}
