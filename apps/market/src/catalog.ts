export interface Product {
  id: string;
  name: string;
  price: number;
  tags: string;
}

export const CATALOG: readonly Product[] = [
  { id: "oat-1", name: "Organic oat milk", price: 4.29, tags: "oat milk dairy-free" },
  { id: "oat-2", name: "Barista oat milk", price: 5.1, tags: "oat milk barista" },
  { id: "alm-1", name: "Almond milk", price: 3.85, tags: "almond milk dairy-free" },
  { id: "cof-1", name: "Ethiopia filter", price: 14.0, tags: "coffee beans" },
  { id: "brd-1", name: "Sourdough loaf", price: 6.5, tags: "bread bakery" },
];

export const money = (n: number): string => `$${n.toFixed(2)}`;
