// Flat config. `next lint` was removed in Next 16, so ESLint is invoked
// directly (`npm run lint`) with the shared Next config.
import next from "eslint-config-next";

const config = [
  {
    ignores: [".next/**", "node_modules/**", "site/**", "showcase/**", "next-env.d.ts", "dist/**"],
  },
  ...next,
  {
    rules: {
      // eslint-plugin-react-hooks v7 (pulled in by eslint-config-next 16) flags
      // ThemeToggle's one-time localStorage read in a useEffect. That read is
      // deliberately deferred past the initial render — reading localStorage
      // during render would crash server-side and desync client/server HTML —
      // so this is the correct pattern the rule doesn't have a case for yet.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
