import { Plus, Trash2 } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";

export interface KvPair {
  k: string;
  v: string;
}

/**
 * KEY / VALUE 并排编辑器 —— 取代"每行一个 KEY=VALUE 字符串"的 textarea 写法。
 * 值里包含 `=` 或 `:` 时字符串解析会切错,两框分开就没这问题。
 *
 * 父组件维持 pairs 数组(有序),保存时自己转 Record<string, string>。
 * 允许空项存在(没填完的行),由父组件保存时过滤。
 */
export function KvEditor({
  pairs,
  onChange,
  placeholderKey,
  placeholderValue,
  separator = "=",
}: {
  pairs: KvPair[];
  onChange: (next: KvPair[]) => void;
  placeholderKey?: string;
  placeholderValue?: string;
  /** 中间显示的分隔符号,env 用 `=`,header 用 `:` */
  separator?: string;
}) {
  const update = (i: number, field: "k" | "v", val: string) => {
    const next = pairs.slice();
    next[i] = { ...next[i], [field]: val };
    onChange(next);
  };
  const remove = (i: number) => {
    onChange(pairs.filter((_, idx) => idx !== i));
  };
  const add = () => {
    onChange([...pairs, { k: "", v: "" }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {pairs.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            placeholder={placeholderKey ?? "KEY"}
            value={p.k}
            onChange={(e) => update(i, "k", e.target.value)}
            className="flex-1 font-mono text-xs"
          />
          <span className="select-none text-xs text-muted-foreground">
            {separator}
          </span>
          <Input
            placeholder={placeholderValue ?? "value"}
            value={p.v}
            onChange={(e) => update(i, "v", e.target.value)}
            className="flex-1 font-mono text-xs"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => remove(i)}
            title="删除"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus />
          添加
        </Button>
      </div>
    </div>
  );
}

/** pairs → Record,空 key 过滤掉 */
export function pairsToRecord(pairs: KvPair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const k = p.k.trim();
    if (!k) continue;
    out[k] = p.v;
  }
  return out;
}

/** Record → pairs(用于编辑态回填) */
export function recordToPairs(r?: Record<string, string>): KvPair[] {
  return Object.entries(r ?? {}).map(([k, v]) => ({ k, v }));
}
