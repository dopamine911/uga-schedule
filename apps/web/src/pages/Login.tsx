import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClapperboardIcon } from "lucide-react"
import { Navigate, useNavigate } from "react-router"
import { ErrorAlert, LoadingBlock } from "@/components/common"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Button } from "@/components/ui/button"
import { api, unwrap } from "@/lib/api"
import { useMe } from "@/lib/auth"
import { humanize, initials } from "@/lib/format"

/** Dev login. Production uses university SSO (F-001 §5); this page lists seeded users instead. */
export function LoginPage() {
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const users = useQuery({
    queryKey: ["dev-users"],
    queryFn: () => unwrap(api.auth["dev-users"].$get()),
  })
  const login = useMutation({
    mutationFn: (userId: string) =>
      unwrap(api.auth["dev-login"].$post({ json: { userId } })),
    onSuccess: async () => {
      await qc.resetQueries()
      navigate("/", { replace: true })
    },
  })

  if (me.data?.user) return <Navigate to="/" replace />

  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="relative flex flex-col justify-between overflow-hidden bg-brand-black p-8 text-white md:p-12">
        <div
          aria-hidden="true"
          className="absolute -right-24 -bottom-24 h-[28rem] w-56 rotate-[24deg] bg-primary"
        />
        <div
          aria-hidden="true"
          className="absolute right-20 -bottom-24 h-[28rem] w-8 rotate-[24deg] bg-white/10"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-md bg-primary">
            <ClapperboardIcon />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[0.625rem] font-bold tracking-[0.2em] text-white/70 uppercase">
              University of Georgia
            </span>
            <span className="font-heading text-xl font-medium tracking-wide uppercase">
              Studio Scheduling
            </span>
          </span>
        </div>
        <div className="relative flex max-w-md flex-col gap-4 py-16">
          <h1 className="text-5xl leading-none font-medium tracking-wide uppercase md:text-6xl">
            Book the studio.
            <br />
            Check out the gear.
          </h1>
          <p className="text-white/80">
            Request studio time, reserve cameras, lights and audio kits, and
            pick up your results — with your sponsor and the studio team in the
            loop.
          </p>
        </div>
        <p className="relative text-xs text-white/60">
          Media studios · Equipment checkout · Production support
        </p>
      </section>

      <section className="flex items-center justify-center bg-background p-6 md:p-10">
        <Card className="w-full max-w-xl border-t-4 border-t-primary">
          <CardHeader>
            <CardTitle className="text-2xl tracking-wide uppercase">
              Sign in
            </CardTitle>
            <CardDescription>
              Development sign-in: pick a demo user. In production this button
              sends you to UGA single sign-on (MyID).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {login.error && <ErrorAlert error={login.error} />}
            {users.isPending && <LoadingBlock rows={6} />}
            {users.error && <ErrorAlert error={users.error} />}
            <ItemGroup>
              {users.data?.map((u) => (
                <Item key={u.id} variant="outline" size="sm">
                  <ItemMedia>
                    <Avatar className="size-9">
                      <AvatarFallback className="bg-secondary font-bold text-secondary-foreground">
                        {initials(u.displayName)}
                      </AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{u.displayName}</ItemTitle>
                    <ItemDescription>
                      {[...new Set(u.roles.map((r) => humanize(r.role)))].join(
                        " · "
                      ) || "No role"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      size="sm"
                      onClick={() => login.mutate(u.id)}
                      disabled={login.isPending}
                    >
                      Sign in
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
