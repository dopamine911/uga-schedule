import type { UnitStatus } from "@studio/domain"
import type { DB } from "./client.ts"
import * as s from "./schema.ts"

// Sample inventory for a university media studio (F-003). Data-driven so it is easy to extend.
// The first five types keep their names, tags and quantities: tests and sample events rely on them.

interface UnitException {
  /** 1-based unit number */
  n: number
  status: UnitStatus
  notes: string
  /** days from today, for in_repair */
  backInDays?: number
}

interface CatalogType {
  name: string
  manufacturer: string
  model: string
  description: string
  maxPerEvent?: number
  serialized?: { prefix: string; count: number; serialPrefix: string; exceptions?: UnitException[] }
  bulk?: { available: number; damaged?: number; inRepair?: number; lost?: number }
}

interface CatalogClass {
  name: string
  minLevelRank: 1 | 2 | 3
  description: string
  types: CatalogType[]
}

export const EQUIPMENT_CATALOG: CatalogClass[] = [
  {
    name: "Audio Basics",
    minLevelRank: 1,
    description: "Studio microphones, headphones, cabling and podcast recorders.",
    types: [
      {
        name: "Shure SM7B Microphone",
        manufacturer: "Shure",
        model: "SM7B",
        description: "Dynamic broadcast microphone for voice and podcasts.",
        maxPerEvent: 4,
        serialized: { prefix: "MIC", count: 4, serialPrefix: "SM7B-100" },
      },
      {
        name: "XLR Cable 25ft",
        manufacturer: "Generic",
        model: "XLR-25",
        description: "Balanced microphone cable, 25 ft.",
        maxPerEvent: 12,
        bulk: { available: 28, damaged: 2 },
      },
      {
        name: "Shure SM58 Microphone",
        manufacturer: "Shure",
        model: "SM58",
        description: "Handheld dynamic vocal microphone.",
        maxPerEvent: 6,
        serialized: { prefix: "SM58", count: 6, serialPrefix: "SM58-21", exceptions: [{ n: 6, status: "damaged", notes: "Grille dented, intermittent cable jack" }] },
      },
      {
        name: "Rode PodMic",
        manufacturer: "Rode",
        model: "PodMic",
        description: "Dynamic podcast microphone with internal pop filter.",
        maxPerEvent: 4,
        serialized: { prefix: "POD", count: 4, serialPrefix: "PDM-30" },
      },
      {
        name: "Audio-Technica ATH-M50x Headphones",
        manufacturer: "Audio-Technica",
        model: "ATH-M50x",
        description: "Closed-back monitoring headphones.",
        maxPerEvent: 6,
        serialized: { prefix: "HP", count: 8, serialPrefix: "M50X-44", exceptions: [{ n: 8, status: "lost", notes: "Not returned after FILM 101 lab, Oct" }] },
      },
      {
        name: "Zoom PodTrak P4",
        manufacturer: "Zoom",
        model: "PodTrak P4",
        description: "Four-channel podcast recorder (records to SD).",
        maxPerEvent: 1,
        serialized: { prefix: "P4", count: 3, serialPrefix: "PT4-55" },
      },
      {
        name: "XLR Cable 10ft",
        manufacturer: "Generic",
        model: "XLR-10",
        description: "Balanced microphone cable, 10 ft.",
        maxPerEvent: 12,
        bulk: { available: 20 },
      },
      {
        name: "Microphone Desk Boom Arm",
        manufacturer: "Rode",
        model: "PSA1+",
        description: "Desk-clamp boom arm for broadcast microphones.",
        maxPerEvent: 4,
        bulk: { available: 8 },
      },
    ],
  },
  {
    name: "Camera Support & Grip",
    minLevelRank: 1,
    description: "Tripods, sandbags and basic grip.",
    types: [
      {
        name: "Manfrotto Video Tripod",
        manufacturer: "Manfrotto",
        model: "504X + 645 Fast",
        description: "Fluid-head video tripod, 12 kg payload.",
        maxPerEvent: 2,
        serialized: { prefix: "TRI", count: 6, serialPrefix: "MF504-7", exceptions: [{ n: 5, status: "in_repair", notes: "Leg lock replacement", backInDays: 4 }] },
      },
      {
        name: "Sandbag 15lb",
        manufacturer: "Matthews",
        model: "Saddle 15",
        description: "Saddle sandbag for stands.",
        bulk: { available: 20 },
      },
      {
        name: "Apple Box Set",
        manufacturer: "Matthews",
        model: "Full/Half/Quarter/Pancake",
        description: "Nesting apple box set.",
        bulk: { available: 4 },
      },
    ],
  },
  {
    name: "Power & Media",
    minLevelRank: 1,
    description: "Batteries, chargers and recording media.",
    types: [
      {
        name: "NP-F970 Battery",
        manufacturer: "Sony",
        model: "NP-F970",
        description: "L-series battery for monitors and LED panels.",
        maxPerEvent: 8,
        bulk: { available: 22, damaged: 2 },
      },
      {
        name: "V-Mount Battery 150Wh",
        manufacturer: "Core SWX",
        model: "Hypercore NEO 150",
        description: "V-mount battery for cinema cameras and lights.",
        maxPerEvent: 4,
        bulk: { available: 7, inRepair: 1 },
      },
      {
        name: "SDXC Card 128GB V60",
        manufacturer: "SanDisk",
        model: "Extreme PRO 128GB",
        description: "UHS-II SD card. Format before returning.",
        maxPerEvent: 4,
        bulk: { available: 26, lost: 4 },
      },
      {
        name: "CFexpress Type A 160GB",
        manufacturer: "Sony",
        model: "CEA-G160T",
        description: "CFexpress Type A card for Sony FX6 / a7 IV.",
        maxPerEvent: 2,
        bulk: { available: 10 },
      },
    ],
  },
  {
    name: "Field Audio",
    minLevelRank: 2,
    description: "Location sound: recorders, shotguns and wireless.",
    types: [
      {
        name: "Zoom F6 Field Recorder",
        manufacturer: "Zoom",
        model: "F6",
        description: "Six-input 32-bit float field recorder.",
        maxPerEvent: 1,
        serialized: { prefix: "F6", count: 3, serialPrefix: "ZF6-90" },
      },
      {
        name: "Sennheiser MKE 600 Shotgun",
        manufacturer: "Sennheiser",
        model: "MKE 600",
        description: "Shotgun microphone with shock mount.",
        maxPerEvent: 2,
        serialized: { prefix: "SG", count: 4, serialPrefix: "MKE6-12" },
      },
      {
        name: "Sennheiser EW-DP Wireless Lav Kit",
        manufacturer: "Sennheiser",
        model: "EW-DP ME2",
        description: "Digital wireless lavalier kit (transmitter + receiver).",
        maxPerEvent: 3,
        serialized: { prefix: "LAV", count: 4, serialPrefix: "EWDP-40", exceptions: [{ n: 4, status: "in_repair", notes: "Receiver antenna connector", backInDays: 9 }] },
      },
      {
        name: "Boom Pole 12ft",
        manufacturer: "K-Tek",
        model: "KE-144CCR",
        description: "Carbon fibre boom pole with internal cable.",
        maxPerEvent: 2,
        bulk: { available: 4 },
      },
      {
        name: "Furry Windscreen",
        manufacturer: "Rycote",
        model: "Classic-Softie",
        description: "Windscreen for shotgun microphones.",
        bulk: { available: 6 },
      },
    ],
  },
  {
    name: "Lighting",
    minLevelRank: 2,
    description: "LED fixtures, modifiers and stands.",
    types: [
      {
        name: "Aputure 300d LED",
        manufacturer: "Aputure",
        model: "300d II",
        description: "Daylight point-source LED, Bowens mount.",
        serialized: { prefix: "LGT", count: 3, serialPrefix: "AP300-200" },
      },
      {
        name: "C-Stand",
        manufacturer: "Matthews",
        model: "40in",
        description: "40\" century stand with grip head and arm.",
        bulk: { available: 10 },
      },
      {
        name: "Aputure 600d Pro",
        manufacturer: "Aputure",
        model: "LS 600d Pro",
        description: "High-output daylight LED with weatherproof head.",
        maxPerEvent: 2,
        serialized: { prefix: "L600", count: 2, serialPrefix: "AP600-31" },
      },
      {
        name: "Aputure MC RGB Light (4-kit)",
        manufacturer: "Aputure",
        model: "MC 4-Light Kit",
        description: "Pocket RGBWW lights in a charging case.",
        maxPerEvent: 1,
        serialized: { prefix: "MC", count: 3, serialPrefix: "APMC-17" },
      },
      {
        name: "Nanlite PavoTube II 30C",
        manufacturer: "Nanlite",
        model: "PavoTube II 30C",
        description: "4 ft RGB tube light.",
        maxPerEvent: 4,
        serialized: { prefix: "TUBE", count: 4, serialPrefix: "NLPT-62" },
      },
      {
        name: "Softbox 90cm Parabolic",
        manufacturer: "Aputure",
        model: "Light Dome II",
        description: "Bowens-mount softbox with grid.",
        maxPerEvent: 3,
        bulk: { available: 5, damaged: 1 },
      },
      {
        name: "V-Flat",
        manufacturer: "V-Flat World",
        model: "Duo Board",
        description: "Collapsible black/white bounce board.",
        bulk: { available: 4 },
      },
    ],
  },
  {
    name: "Cameras",
    minLevelRank: 2,
    description: "Mirrorless and compact cinema cameras.",
    types: [
      {
        name: "Sony a7 IV Kit",
        manufacturer: "Sony",
        model: "ILCE-7M4",
        description: "Full-frame mirrorless body, 2 batteries, charger, cage.",
        maxPerEvent: 2,
        serialized: { prefix: "A7", count: 4, serialPrefix: "A7M4-80" },
      },
      {
        name: "Canon EOS R6 Mark II Kit",
        manufacturer: "Canon",
        model: "EOS R6 II",
        description: "Full-frame mirrorless body with RF 24-105 f/4.",
        maxPerEvent: 2,
        serialized: { prefix: "R6", count: 3, serialPrefix: "R6M2-41" },
      },
      {
        name: "Blackmagic Pocket Cinema Camera 6K Pro",
        manufacturer: "Blackmagic Design",
        model: "BMPCC 6K Pro",
        description: "Super 35 BRAW camera, EF mount.",
        maxPerEvent: 1,
        serialized: { prefix: "BM6K", count: 3, serialPrefix: "BMPCC-66", exceptions: [{ n: 3, status: "retired", notes: "Mainboard failure, written off" }] },
      },
      {
        name: "DJI RS 3 Pro Gimbal",
        manufacturer: "DJI",
        model: "RS 3 Pro",
        description: "Handheld 3-axis gimbal, 4.5 kg payload.",
        maxPerEvent: 1,
        serialized: { prefix: "GMB", count: 2, serialPrefix: "RS3P-05" },
      },
    ],
  },
  {
    name: "Lenses",
    minLevelRank: 2,
    description: "Photo-style zooms and primes.",
    types: [
      {
        name: "Sony FE 24-70mm f/2.8 GM II",
        manufacturer: "Sony",
        model: "SEL2470GM2",
        description: "Standard zoom, E-mount.",
        maxPerEvent: 2,
        serialized: { prefix: "LZ2470", count: 3, serialPrefix: "SEL2470-1" },
      },
      {
        name: "Sigma 18-35mm f/1.8 Art",
        manufacturer: "Sigma",
        model: "18-35 DC HSM Art",
        description: "Fast Super 35 zoom, EF mount.",
        maxPerEvent: 1,
        serialized: { prefix: "LZ1835", count: 2, serialPrefix: "SIG1835-7" },
      },
      {
        name: "Sony FE 85mm f/1.8",
        manufacturer: "Sony",
        model: "SEL85F18",
        description: "Portrait prime, E-mount.",
        maxPerEvent: 1,
        serialized: { prefix: "LP85", count: 2, serialPrefix: "SEL85-3" },
      },
    ],
  },
  {
    name: "Monitoring",
    minLevelRank: 2,
    description: "On-camera monitors and recorders.",
    types: [
      {
        name: "Atomos Ninja V Monitor",
        manufacturer: "Atomos",
        model: "Ninja V",
        description: "5\" HDR monitor-recorder.",
        maxPerEvent: 2,
        serialized: { prefix: "NINJA", count: 3, serialPrefix: "ATNV-28" },
      },
      {
        name: "SmallHD Cine 7",
        manufacturer: "SmallHD",
        model: "Cine 7",
        description: "7\" daylight-viewable director's monitor.",
        maxPerEvent: 1,
        serialized: { prefix: "CINE7", count: 2, serialPrefix: "SHC7-09" },
      },
    ],
  },
  {
    name: "Cinema Cameras",
    minLevelRank: 3,
    description: "Cinema cameras and large stabilizers. Sound stage training required.",
    types: [
      {
        name: "Sony FX6 Kit",
        manufacturer: "Sony",
        model: "ILME-FX6",
        description: "Full-frame cinema camera, top handle, LCD, 2 BP-U batteries.",
        maxPerEvent: 1,
        serialized: {
          prefix: "CAM",
          count: 3,
          serialPrefix: "FX6-500",
          exceptions: [{ n: 3, status: "in_repair", notes: "Sensor cleaning", backInDays: 10 }],
        },
      },
      {
        name: "Canon EOS C70 Kit",
        manufacturer: "Canon",
        model: "EOS C70",
        description: "Super 35 cinema camera, RF mount, with EF adapter.",
        maxPerEvent: 1,
        serialized: { prefix: "C70", count: 2, serialPrefix: "C70-118" },
      },
      {
        name: "RED Komodo 6K Kit",
        manufacturer: "RED",
        model: "Komodo 6K",
        description: "Global-shutter 6K camera, RF mount, 2 CFast cards.",
        maxPerEvent: 1,
        serialized: { prefix: "KOMODO", count: 1, serialPrefix: "RK6K-00" },
      },
      {
        name: "DJI Ronin 2 Gimbal",
        manufacturer: "DJI",
        model: "Ronin 2",
        description: "Heavy-duty 3-axis gimbal, 13.6 kg payload.",
        maxPerEvent: 1,
        serialized: { prefix: "RONIN", count: 1, serialPrefix: "RON2-00" },
      },
    ],
  },
  {
    name: "Cinema Lenses",
    minLevelRank: 3,
    description: "Matched cine prime sets.",
    types: [
      {
        name: "DZOFilm Vespid Prime Set (7)",
        manufacturer: "DZOFilm",
        model: "Vespid 16/25/35/50/75/100/125",
        description: "Seven-lens full-frame cine prime set, PL/EF.",
        maxPerEvent: 1,
        serialized: { prefix: "VESPID", count: 1, serialPrefix: "DZV-00" },
      },
      {
        name: "Sigma Cine Prime Set (5)",
        manufacturer: "Sigma",
        model: "FF High Speed 20/24/35/50/85",
        description: "Five-lens T1.5 cine prime set, EF.",
        maxPerEvent: 1,
        serialized: { prefix: "SIGCINE", count: 1, serialPrefix: "SGC-00" },
      },
    ],
  },
]

/**
 * Inserts the catalog. `levelIdByRank` maps rank → level id; `dayOffset` gives "YYYY-MM-DD" n days from today.
 * Returns inserted types by name so other seed data can reference them.
 */
export function seedEquipment(
  db: DB,
  levelIdByRank: Record<1 | 2 | 3, string>,
  dayOffset: (n: number) => string,
): Map<string, typeof s.equipmentTypes.$inferSelect> {
  const byName = new Map<string, typeof s.equipmentTypes.$inferSelect>()
  for (const cls of EQUIPMENT_CATALOG) {
    const c = db
      .insert(s.equipmentClasses)
      .values({ name: cls.name, minLevelId: levelIdByRank[cls.minLevelRank], description: cls.description })
      .returning()
      .get()
    for (const t of cls.types) {
      const type = db
        .insert(s.equipmentTypes)
        .values({
          classId: c.id,
          name: t.name,
          manufacturer: t.manufacturer,
          model: t.model,
          description: t.description,
          tracking: t.serialized ? "serialized" : "bulk",
          maxPerEvent: t.maxPerEvent ?? null,
        })
        .returning()
        .get()
      byName.set(t.name, type)
      if (t.serialized) {
        const { prefix, count, serialPrefix, exceptions = [] } = t.serialized
        db.insert(s.equipmentUnits)
          .values(
            Array.from({ length: count }, (_, i) => {
              const n = i + 1
              const ex = exceptions.find((e) => e.n === n)
              return {
                typeId: type.id,
                assetTag: `${prefix}-${String(n).padStart(3, "0")}`,
                serialNumber: `${serialPrefix}${n}`,
                status: ex?.status ?? "available",
                expectedBack: ex?.backInDays === undefined ? null : dayOffset(ex.backInDays),
                notes: ex?.notes ?? "",
              }
            }),
          )
          .run()
      } else if (t.bulk) {
        db.insert(s.bulkStock)
          .values({
            typeId: type.id,
            qtyAvailable: t.bulk.available,
            qtyDamaged: t.bulk.damaged ?? 0,
            qtyInRepair: t.bulk.inRepair ?? 0,
            qtyLost: t.bulk.lost ?? 0,
          })
          .run()
      }
    }
  }
  return byName
}
