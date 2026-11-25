import {
  DashboardHeader,
  NotificationsCard,
  UpcomingEventsCard,
} from "@/pages/DashboardSections"
import { QueueSection, queueChips } from "@/pages/home/QueueSections"
import { useDashboardData } from "@/pages/useDashboardData"

// Home page: the work queue (what needs the user, most urgent first), what is coming up, and unread notifications.

export function DashboardPage() {
  const d = useDashboardData()
  return (
    <>
      <DashboardHeader
        now={d.now}
        tz={d.tz}
        displayName={d.displayName}
        roles={d.roles}
        level={d.access.data?.effectiveLevelToday}
        canRequest={d.canRequest}
        chips={d.queue.data && queueChips(d.queue.data.counts)}
      />

      <QueueSection query={d.queue} now={d.now} tz={d.tz} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <UpcomingEventsCard
          query={d.upcomingQuery}
          isSponsor={d.isSponsor}
          canRequest={d.canRequest}
        />
        <NotificationsCard
          query={d.notifications}
          unread={d.unread}
          tz={d.tz}
        />
      </div>
    </>
  )
}
