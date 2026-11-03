// Where each slide of a grouped deck sits in Setup's grid. Slides of a group sit closer together than groups do, and a group
// moves to the next row rather than leave one slide of it alone at a row's end (a slot or less is all a row leaves empty).
// Each full row's slides are sized so the row spans the grid; other rows take their neighbour's size.

/** A slide's place: its row, its left edge and width, and the space before and after it on its row. */
export interface Place {
  row: number;
  x: number;
  w: number;
  before: number;
  after: number;
  /** The first of its group's slides on this row, which carries the group's label. */
  head: boolean;
  /** The last slide on its row. */
  end: boolean;
}

export interface Metrics {
  width: number;
  cols: number;
  /** Space between slides of one group, and between groups. */
  tight: number;
  apart: number;
}

export function pack(sizes: readonly number[], m: Metrics): Place[] {
  const rows: number[][] = [[]];
  const group: number[] = [];
  sizes.forEach((n, gi) => {
    let row = rows.at(-1)!;
    const left = m.cols - row.length;
    if (row.length && n > left && left <= 1) rows.push((row = []));
    for (let k = 0; k < n; k++) {
      if (row.length === m.cols) rows.push((row = []));
      row.push(group.length);
      group.push(gi);
    }
  });
  const gaps = rows.map((row) => row.slice(1).map((i) => (group[i] === group[i - 1] ? m.tight : m.apart)));
  const fill = rows.map((row, r) => (row.length === m.cols ? (m.width - gaps[r].reduce((a, b) => a + b, 0)) / m.cols : 0));
  const near = (r: number) => fill.slice(0, r).reverse().find(Boolean) ?? fill.slice(r).find(Boolean) ?? (m.width - (m.cols - 1) * m.apart) / m.cols;
  const out: Place[] = [];
  rows.forEach((row, r) => {
    const w = fill[r] || near(r);
    let x = 0;
    row.forEach((i, k) => {
      const before = k ? gaps[r][k - 1] : m.apart;
      if (k) x += w + before;
      const end = k === row.length - 1;
      out[i] = { row: r, x, w, before, after: end ? m.apart : gaps[r][k], head: !k || group[i] !== group[i - 1], end };
    });
  });
  return out;
}
