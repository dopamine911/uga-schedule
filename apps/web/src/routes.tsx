import { createBrowserRouter } from "react-router"
import { RequireAuth } from "@/components/AppLayout"
import { AuditPage } from "@/pages/admin/Audit"
import { CoursePage } from "@/pages/admin/Course"
import { EventTypeEditPage } from "@/pages/admin/EventTypeEdit"
import { EventTypesPage } from "@/pages/admin/EventTypes"
import { InventoryPage } from "@/pages/admin/Inventory"
import { InventoryTypePage } from "@/pages/admin/InventoryType"
import { LevelsPage } from "@/pages/admin/Levels"
import { PoliciesPage } from "@/pages/admin/Policies"
import { StudiosPage } from "@/pages/admin/Studios"
import { UserDetailPage } from "@/pages/admin/UserDetail"
import { UsersPage } from "@/pages/admin/Users"
import { CalendarSettingsPage } from "@/pages/CalendarSettings"
import { DashboardPage } from "@/pages/Dashboard"
import { EventDetailPage } from "@/pages/events/EventDetail"
import { EventFormPage } from "@/pages/events/EventForm"
import { EventListPage } from "@/pages/events/EventList"
import { CatalogPage } from "@/pages/equipment/Catalog"
import { InboxPage } from "@/pages/Inbox"
import { LoginPage } from "@/pages/Login"
import { MyAccessPage } from "@/pages/MyAccess"
import { ResultPackagePage } from "@/pages/results/ResultPackage"
import { ResultsListPage } from "@/pages/results/ResultsList"
import { ApprovalsPage } from "@/pages/staff/Approvals"
import { CheckinPage } from "@/pages/staff/Checkin"
import { CheckoutPage } from "@/pages/staff/Checkout"
import { DeskPage } from "@/pages/staff/Desk"
import { HoldsPage } from "@/pages/staff/Holds"
import { SchedulePage } from "@/pages/staff/Schedule"

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "events", element: <EventListPage /> },
      { path: "events/new", element: <EventFormPage /> },
      { path: "events/:id", element: <EventDetailPage /> },
      { path: "events/:id/edit", element: <EventFormPage /> },
      { path: "events/:id/checkout", element: <CheckoutPage /> },
      { path: "events/:id/checkin", element: <CheckinPage /> },
      { path: "results", element: <ResultsListPage /> },
      { path: "results/:eventId", element: <ResultPackagePage /> },
      { path: "inbox", element: <InboxPage /> },
      { path: "me/access", element: <MyAccessPage /> },
      { path: "equipment", element: <CatalogPage /> },
      { path: "settings/calendar", element: <CalendarSettingsPage /> },
      { path: "approvals", element: <ApprovalsPage /> },
      { path: "desk", element: <DeskPage /> },
      { path: "schedule", element: <SchedulePage /> },
      { path: "holds", element: <HoldsPage /> },
      { path: "admin/inventory", element: <InventoryPage /> },
      { path: "admin/inventory/:id", element: <InventoryTypePage /> },
      { path: "admin/levels", element: <LevelsPage /> },
      { path: "admin/courses/:id", element: <CoursePage /> },
      { path: "admin/users", element: <UsersPage /> },
      { path: "admin/users/:id", element: <UserDetailPage /> },
      { path: "admin/studios", element: <StudiosPage /> },
      { path: "admin/event-types", element: <EventTypesPage /> },
      { path: "admin/event-types/:id", element: <EventTypeEditPage /> },
      { path: "admin/policies", element: <PoliciesPage /> },
      { path: "admin/audit", element: <AuditPage /> },
    ],
  },
])
