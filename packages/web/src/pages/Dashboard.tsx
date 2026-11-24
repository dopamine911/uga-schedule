import { attentionChips } from "@/pages/dashboard-data"
import {
  DashboardHeader,
  ExpiringAccessBanners,
  HoldBanners,
  NeedsActionCard,
  NotificationsCard,
  StaffCards,
  UpcomingEventsCard,
} from "@/pages/DashboardSections"
import { useDashboardData } from "@/pages/useDashboardData"

// Home page: alerts, what needs the user, what is coming up, and recent unread notifications.

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
        chips={attentionChips({
          overdueReturns: d.overdueOut,
          activeHolds: d.activeHolds.length,
          actions: d.actions.length,
          expiringGrants: d.expiring.length,
          waiting: d.waitingCount,
        })}
      />

      <HoldBanners error={d.holds.error} holds={d.activeHolds} />
      <ExpiringAccessBanners grants={d.expiring} />

      <StaffCards
        canDesk={d.canDesk}
        canStaffDecide={d.canStaffDecide}
        pickups={d.desk.pickups}
        returns={d.desk.returns}
        awaiting={d.awaitingConfirmation}
        overdueOut={d.overdueOut}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <UpcomingEventsCard
          query={d.upcomingQuery}
          isSponsor={d.isSponsor}
          canRequest={d.canRequest}
        />

        <div className="flex flex-col gap-6">
          <NeedsActionCard actions={d.actions} loading={d.actionsLoading} />
          <NotificationsCard
            query={d.notifications}
            unread={d.unread}
            tz={d.tz}
          />
        </div>
      </div>
    </>
  )
}
