// Public game and recommendation copy shared by the browser host.
import { GAME_ID } from "./ids.mjs";
export const GAMES = [
  {
    id: GAME_ID.SEED_KEEPERS,
    name: "Seed Keepers",
    type: "FIND YOUR RHYTHM",
    tag: "Rhythm & reaction",
    description:
      "Meet the little seed keepers. Read the rhythm, choose your next move and bring a garden to life.",
    how: "Tap a keeper to collect a seed. By default, this is a visually timed game: keepers leave when their rings close. Gentle gives you more time and uses taps only; it still has timed misses. Balanced and Curious also ask you to hold. A wave ends after 50 helpers. Collect at least 70% to meet its goal. For one keeper at a time with no deadline, turn on Unhurried turns below. Its target text names the hole, action and key. The 50-helper goal stays the same.",
    why: "A clear rhythm and immediate feedback give your attention a concrete task. Choose a pace that feels comfortable.",
    skill: "React & prioritise",
    time: "About 2 minutes",
  },
  {
    id: GAME_ID.LANTERN_DRIFT,
    name: "Lantern Drift",
    type: "FOLLOW A LITTLE LIGHT",
    tag: "Movement & exploration",
    description:
      "Guide a little light through an evening garden. Follow the open route, or reach for a little extra glow.",
    how: "Move left and right to pass through the open gates. Use the on-screen controls, your pointer or arrow keys. The forward pace stays steady. Pass 12 of 15 gates to meet the level goal. Side lights are optional; missing one never blocks your journey.",
    why: "A steady journey offers one continuous task. Follow the open route, or choose a little more challenge.",
    skill: "Steer & explore",
    time: "About 1 minute",
  },
  {
    id: GAME_ID.A_PLACE_FOR_EVERYTHING,
    name: "A Place for Everything",
    type: "MAKE A LITTLE SPACE",
    tag: "Logic & arranging",
    description:
      "Find how the clues fit together. Give every object a place, then enjoy a small corner you have made your own.",
    how: "Select an object, then a square. Follow every visible clue. Next to means sharing a side; diagonals do not count. Check your arrangement, undo a move or ask for a hint.",
    why: "A small set of visible rules turns a busy space into a solvable task. Find an arrangement, then make it yours.",
    skill: "Arrange & reason",
    time: "2-5 minutes",
  },
  {
    id: GAME_ID.HIDDEN_SEASONS,
    name: "Hidden Seasons",
    type: "FOLLOW YOUR CURIOSITY",
    tag: "Patterns & discovery",
    description:
      "Notice a changing pattern. Test your idea and uncover a landscape, one small discovery at a time.",
    how: "Study the examples and choose what comes next. Click an answer or press its number key to choose it. A pattern can rotate a shape, change the number of marks or alternate changes. The possible changes are shown in the game. One rule stays in place for all six discoveries.",
    why: "Look for a changing pattern, test your idea, and uncover a scene. Take as much time as you need.",
    skill: "Notice & discover",
    time: "2-5 minutes",
  },
];
export const STATES = [
  {
    id: "settle",
    label: "Settle down",
    pick: "order",
    tier: 0,
    duration: 120,
    note: "A small, still task with visible clues. Or choose a rhythm if you would rather tap than think.",
  },
  {
    id: "restless",
    label: "Feel restless",
    pick: "moles",
    tier: 1,
    duration: 300,
    note: "Try a clear rhythm with something to do. Keep a comfortable pace; faster is optional.",
  },
  {
    id: "thoughts",
    label: "Busy thoughts",
    pick: "landscape",
    tier: 1,
    duration: 300,
    note: "Give your attention a concrete mystery. There is no time limit on your next thought.",
  },
  {
    id: "tired",
    label: "Low energy",
    pick: "order",
    tier: 0,
    duration: 120,
    note: "Keep it familiar and small. A little corner is enough for one session.",
  },
  {
    id: "focus",
    label: "Find focus",
    pick: "landscape",
    tier: 1,
    duration: 600,
    note: "Choose your kind of challenge. Levels introduce new decisions; a steady pace keeps the same difficulty.",
  },
  {
    id: "sleep",
    label: "Wind down",
    pick: "order",
    tier: 0,
    duration: 120,
    note: "A familiar, gentle task with a clear ending. If playing makes you feel more awake, finish whenever you like.",
  },
];
export const HOME_COPY = {
  moles: "Find a steady rhythm and collect little seeds.",
  firefly: "Follow the open path and gather a little glow.",
  order: "Follow a few clues. Give everything a place.",
  landscape: "Find the changing rule and uncover a new scene.",
};
