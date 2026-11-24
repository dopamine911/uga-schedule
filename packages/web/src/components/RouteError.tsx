import { TriangleAlertIcon } from "lucide-react"
import { isRouteErrorResponse, Link, useRouteError } from "react-router"
import { EmptyState } from "@/components/common"
import { Button } from "@/components/ui/button"

function messageOf(error: unknown): string {
  if (isRouteErrorResponse(error))
    return error.status === 404
      ? "This page doesn't exist."
      : `The server answered ${error.status} ${error.statusText}.`
  return "This page hit an unexpected problem. Your saved work is not affected."
}

/**
 * Fallback for a route that failed to render or load. Used on the root route and again inside the
 * signed-in layout, so a crash on one page keeps the navigation around it.
 */
export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-1 items-center justify-center p-6"
    >
      <EmptyState
        icon={TriangleAlertIcon}
        title={notFound ? "Page not found" : "Something went wrong"}
        description={messageOf(error)}
      >
        <div className="flex flex-wrap justify-center gap-2">
          {!notFound && (
            <Button onClick={() => window.location.reload()}>Reload</Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/">Back to dashboard</Link>
          </Button>
        </div>
      </EmptyState>
    </div>
  )
}
