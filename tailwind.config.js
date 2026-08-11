export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        body: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"]
      },
      colors: {
        brand: {
          cream: "#FAF7ED",
          teal: "#0D5C6F",
          deep: "#083D48",
          card: "#0C4A57",
          line: "#1A5C6A",
          cyan: "#2AABB8",
          orange: "#EC9960",
          soft: "#8AACB4",
          muted: "#5A7A82",
          mist: "#D4E4E8",
          ink: "#1A2E35",
          mint: "#A8D5BA"
        }
      },
      boxShadow: {
        soft: "0 20px 60px rgba(26, 46, 53, 0.09)"
      }
    }
  },
  plugins: []
};
