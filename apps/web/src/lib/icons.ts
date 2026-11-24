import type { EventState } from "@studio/domain"
import {
  ApertureIcon,
  AudioLinesIcon,
  BanIcon,
  BatteryChargingIcon,
  BoxIcon,
  CalendarCheckIcon,
  CameraIcon,
  CircleCheckIcon,
  CirclePlayIcon,
  CircleXIcon,
  ClapperboardIcon,
  FilePenIcon,
  FilmIcon,
  FocusIcon,
  GraduationCapIcon,
  Grid2x2Icon,
  HourglassIcon,
  LightbulbIcon,
  type LucideIcon,
  MicIcon,
  MonitorPlayIcon,
  PackageCheckIcon,
  PodcastIcon,
  TimerOffIcon,
  UserCheckIcon,
  UserXIcon,
  VideoIcon,
} from "lucide-react"

// One place that decides which Lucide icon represents a domain concept, so every page agrees.

/** Equipment classes are admin-defined, so match on keywords in the class name; order matters. */
const CLASS_ICONS: [RegExp, LucideIcon][] = [
  [/cinema.*lens|lens.*cinema/i, FocusIcon],
  [/lens/i, ApertureIcon],
  [/cinema/i, ClapperboardIcon],
  [/field audio|location/i, AudioLinesIcon],
  [/audio|mic|sound/i, MicIcon],
  [/light/i, LightbulbIcon],
  [/monitor/i, MonitorPlayIcon],
  [/support|grip|tripod/i, Grid2x2Icon],
  [/power|batter|media/i, BatteryChargingIcon],
  [/camera/i, CameraIcon],
]

export function equipmentClassIcon(className: string): LucideIcon {
  return CLASS_ICONS.find(([re]) => re.test(className))?.[1] ?? BoxIcon
}

const EVENT_TYPE_ICONS: [RegExp, LucideIcon][] = [
  [/podcast|audio|record/i, PodcastIcon],
  [/thesis|capstone/i, GraduationCapIcon],
  [/shoot|film|video/i, VideoIcon],
]

export function eventTypeIcon(typeName: string): LucideIcon {
  return EVENT_TYPE_ICONS.find(([re]) => re.test(typeName))?.[1] ?? FilmIcon
}

export const STATE_ICON: Record<EventState, LucideIcon> = {
  Draft: FilePenIcon,
  Submitted: HourglassIcon,
  SponsorApproved: UserCheckIcon,
  Confirmed: CalendarCheckIcon,
  InProgress: CirclePlayIcon,
  PostEvent: PackageCheckIcon,
  Closed: CircleCheckIcon,
  Rejected: CircleXIcon,
  Expired: TimerOffIcon,
  Cancelled: BanIcon,
  NoShow: UserXIcon,
}
