import { Badge, Button, CarIcon, Card } from "../components/ui";
import { signOut } from "../lib/session";

export function PendingPage({ name }: { name: string }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center gap-4 px-6 pt-[140px]">
      <div className="flex size-[84px] items-center justify-center rounded-[22px] bg-ink">
        <CarIcon />
      </div>
      <h1 className="mt-2 text-[28px] font-bold">Auto-Kalender</h1>
      <Card className="mt-4 flex w-full flex-col items-center gap-2 p-5 text-center">
        <Badge>Wartet auf Freigabe</Badge>
        <span className="text-[17px] font-semibold">Hallo {name}!</span>
        <span className="text-[15px] text-muted">Der Admin muss dich noch freischalten. Du bekommst Bescheid, sobald es so weit ist – schau einfach später wieder rein.</span>
        <Button className="mt-2" size="sm" onClick={() => void signOut()}>
          Abmelden
        </Button>
      </Card>
    </div>
  );
}
