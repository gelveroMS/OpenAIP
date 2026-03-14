import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/ui/utils";

type CitizenExplainerCardProps = {
  title: string;
  children?: ReactNode;
  body?: string;
  icon?: ReactNode;
  className?: string;
};

export default function CitizenExplainerCard({
  title,
  children,
  body,
  icon,
  className,
}: CitizenExplainerCardProps) {
  const resolvedIcon = icon ?? (
    <BookOpen className="h-5 w-5 text-[#2563EB]" />
  );

  return (
    <Card className={cn("border border-slate-200 bg-white shadow-sm", className)}>
      <CardContent className="space-y-2 px-3 py-3 sm:px-4 md:px-6">
        <div className="flex items-start gap-3">
          <div className="flex h-[28px] items-center">{resolvedIcon}</div>
          <div className="space-y-2.5">
            <h2 className="text-base font-bold leading-6 text-[#022437] md:text-lg md:leading-7">{title}</h2>
            {children ?? (
              <p className="text-xs leading-6 text-slate-600 md:text-sm md:leading-6">
                {body}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
