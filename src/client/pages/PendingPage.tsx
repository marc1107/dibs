import { Badge, Button, AppIcon, Card } from "../components/ui";
import { signOut } from "../lib/session";

export function PendingPage({ name }: { name: string }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center gap-4 px-6 pt-[140px]">
      <AppIcon />
      <h1 className="mt-2 font-rounded text-[32px] font-extrabold tracking-[-0.5px]">dibs</h1>
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
