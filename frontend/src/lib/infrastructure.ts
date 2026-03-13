export type InfrastructureRoute = {
  id: string;
  kind: "cable" | "oil";
  label: string;
  path: [number, number][];
};

export type InfrastructureHub = {
  id: string;
  kind: "landing" | "datacenter" | "ixp";
  label: string;
  position: [number, number];
  intensity: number;
};

export const INFRASTRUCTURE_ROUTES: InfrastructureRoute[] = [
  {
    id: "atlantic-north",
    kind: "cable",
    label: "Atlântico Norte",
    path: [
      [-74.0, 40.7],
      [-47.0, 47.0],
      [-9.1, 38.7],
      [2.3, 48.8],
    ],
  },
  {
    id: "atlantic-south",
    kind: "cable",
    label: "Atlântico Sul",
    path: [
      [-46.3, -23.9],
      [-28.0, -9.0],
      [-16.2, 14.7],
      [-9.1, 38.7],
    ],
  },
  {
    id: "europe-asia",
    kind: "cable",
    label: "Europa-Ásia",
    path: [
      [5.0, 52.0],
      [29.0, 31.2],
      [55.3, 25.2],
      [77.6, 12.9],
      [103.8, 1.3],
      [139.7, 35.6],
    ],
  },
  {
    id: "pacific-ring",
    kind: "cable",
    label: "Anel do Pacífico",
    path: [
      [139.7, 35.6],
      [151.2, -33.8],
      [-157.8, 21.3],
      [-118.2, 34.0],
    ],
  },
  {
    id: "indian-ocean",
    kind: "cable",
    label: "Corredor do Índico",
    path: [
      [103.8, 1.3],
      [72.8, 19.0],
      [55.3, 25.2],
      [32.6, -26.0],
    ],
  },
  {
    id: "oil-gulf-europe",
    kind: "oil",
    label: "Golfo para Europa",
    path: [
      [51.5, 25.3],
      [44.0, 29.0],
      [32.5, 30.0],
      [14.4, 35.9],
      [4.9, 43.3],
    ],
  },
  {
    id: "oil-gulf-asia",
    kind: "oil",
    label: "Golfo para Ásia",
    path: [
      [51.5, 25.3],
      [65.0, 24.0],
      [80.3, 13.0],
      [103.8, 1.3],
      [121.0, 14.5],
    ],
  },
  {
    id: "oil-americas",
    kind: "oil",
    label: "Américas",
    path: [
      [-95.0, 29.0],
      [-79.9, 9.0],
      [-46.3, -23.9],
      [-5.0, 36.0],
    ],
  },
  {
    id: "oil-africa-asia",
    kind: "oil",
    label: "África para Ásia",
    path: [
      [18.4, -33.9],
      [32.6, -26.0],
      [51.5, 25.3],
      [72.8, 19.0],
      [103.8, 1.3],
    ],
  },
];

export const INFRASTRUCTURE_HUBS: InfrastructureHub[] = [
  { id: "landing-miami", kind: "landing", label: "Miami landing", position: [-80.2, 25.7], intensity: 7 },
  { id: "landing-lisbon", kind: "landing", label: "Lisboa landing", position: [-9.1, 38.7], intensity: 6 },
  { id: "landing-marseille", kind: "landing", label: "Marselha landing", position: [5.4, 43.3], intensity: 6 },
  { id: "landing-singapore", kind: "landing", label: "Singapura landing", position: [103.8, 1.3], intensity: 8 },
  { id: "landing-tokyo", kind: "landing", label: "Tóquio landing", position: [139.7, 35.6], intensity: 7 },
  { id: "landing-fortaleza", kind: "landing", label: "Fortaleza landing", position: [-38.5, -3.7], intensity: 6 },
  { id: "dc-ashburn", kind: "datacenter", label: "Ashburn DC", position: [-77.5, 39.0], intensity: 8 },
  { id: "dc-frankfurt", kind: "datacenter", label: "Frankfurt DC", position: [8.7, 50.1], intensity: 8 },
  { id: "dc-sao-paulo", kind: "datacenter", label: "São Paulo DC", position: [-46.6, -23.5], intensity: 7 },
  { id: "dc-singapore", kind: "datacenter", label: "Singapore DC", position: [103.8, 1.3], intensity: 8 },
  { id: "dc-dubai", kind: "datacenter", label: "Dubai DC", position: [55.3, 25.2], intensity: 6 },
  { id: "dc-sydney", kind: "datacenter", label: "Sydney DC", position: [151.2, -33.8], intensity: 6 },
  { id: "ixp-london", kind: "ixp", label: "LINX", position: [-0.1, 51.5], intensity: 8 },
  { id: "ixp-amsterdam", kind: "ixp", label: "AMS-IX", position: [4.9, 52.3], intensity: 8 },
  { id: "ixp-saopaulo", kind: "ixp", label: "IX.br São Paulo", position: [-46.6, -23.5], intensity: 7 },
  { id: "ixp-johannesburg", kind: "ixp", label: "JINX", position: [28.0, -26.2], intensity: 5 },
  { id: "ixp-singapore", kind: "ixp", label: "SGIX", position: [103.8, 1.3], intensity: 7 },
  { id: "ixp-tokyo", kind: "ixp", label: "JPIX", position: [139.7, 35.6], intensity: 6 },
];
