import { Button } from "./ios/controls";
import { setTvDisplay, useTvDisplay, type TvDisplay } from "../tvDisplay";
import { useStore } from "../store";

export default function TvDisplaySettings() {
  const display = useTvDisplay();
  const { toast } = useStore();
  const update = (value: TvDisplay) => {
    if (!setTvDisplay(value)) toast("画面边距已调整，本次未能保存", "info");
  };
  return <div className="tv-display-settings">
    {([["horizontal", "左右边距"], ["top", "顶部边距"], ["bottom", "底部边距"]] as const).map(([key, label]) =>
      <div key={key} className="tv-display-row">
        <span>{label}</span>
        <div className="tv-display-stepper">
          <Button aria-label={`减少${label}`} disabled={display[key] === 0}
            onClick={() => update({ ...display, [key]: display[key] - 1 })}>−</Button>
          <output aria-label={label}>{display[key]}%</output>
          <Button aria-label={`增加${label}`} disabled={display[key] === 12}
            onClick={() => update({ ...display, [key]: display[key] + 1 })}>＋</Button>
        </div>
      </div>)}
    <Button className="tv-display-reset" onClick={() => update({ horizontal: 3, top: 3, bottom: 3 })}>恢复默认边距</Button>
  </div>;
}
