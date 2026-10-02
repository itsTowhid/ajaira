# Jelly Platter 🍉

Five jelly-like fruit slices — watermelon, orange, kiwi, dragon fruit and apple — built with
Three.js. Each one wobbles, can be cut into pieces, and can be shoved around the plate.

## Run

```sh
pnpm install
pnpm dev
```

## Controls

- **Click** a piece to cut it radially in two (up to 18 pieces). Clicking too near the tip, or a
  piece too thin to halve, just pokes it.
- **Drag** a piece to slide it around the plate. It pushes the others out of the way, jiggles
  while it moves, and keeps thrown momentum when released.
- **Drag the plate** to orbit, **wheel** to zoom, **Space** to wobble everything, **R** to reset.

## How it works

- **Fruits** (`fruits.ts`) — each fruit is data: a radius, thickness, angular span, a stacked list
  of radial layers (rind, pith, flesh, core) with their material settings, an optional citrus
  segment spec, a seed layout, and its juice colour. Adding a fruit is adding an entry to
  `FRUITS`; the ring position of each slice is derived from its index by `layoutFor`.
- **Geometry** (`wedge.ts`) — every layer is an extruded sector with rounded bevels. A slice is
  just several of these stacked radially. Seeds come in four layouts (scattered, ringed around a
  core, clustered at the core, or dense speckle) and are stored in absolute angle space, so a
  seed survives exactly the cuts that keep it inside its piece.
- **Jelly body** (`jelly.ts`) — each piece runs two damped springs (a vertical squash and a
  lateral sway) plus a periodic idle breath. The squash drives the piece's Y scale; the squash
  and sway also drive displacement in the vertex shader, along with travelling sine ripples, so
  the surface bulges and sloshes like set jelly. Rind layers wobble less than flesh.
- **Non-overlap** (`physics.ts`) — every piece carries a convex footprint (the tip plus the outer
  arc sampled as a polygon). Each frame an iterative SAT solver computes the minimum translation
  vector for every overlapping pair and slides them apart, weighted by piece mass, with the
  dragged piece treated as immovable. A plate-radius constraint keeps the pile inside.
- The shader deformation is faded out near a piece's two radial faces and near its tip, and the
  collision footprint is the undeformed wedge. That combination is what guarantees pieces touch
  but never sink into each other, no matter how hard they wobble. The fade is computed from a
  wrapped angular distance so it holds for slices whose angles run past ±π.
- **Cutting** (`world.ts`) — a hit point is converted to an angle around that piece's tip, and the
  piece is rebuilt as two smaller wedges that inherit the anchor, base angle, seeds and springs.
  They pop apart with a velocity impulse, a spray of juice droplets in that fruit's colour and a
  flash along the cut.
