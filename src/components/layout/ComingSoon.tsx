import { Wrench } from "lucide-react";

export function ComingSoon({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <Wrench className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground/60">开发中</p>
      </div>
    </div>
  );
}
