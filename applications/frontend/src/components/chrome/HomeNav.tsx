import Link from "next/link";

type HomeNavProps = {
  active: "library" | "history";
};

export const HomeNav = ({ active }: HomeNavProps) => {
  return (
    <nav className="home-nav">
      <Link
        href="/"
        className={["", active === "library" ? "is-active" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        ライブラリ
      </Link>
      <Link
        href="/history"
        className={["", active === "history" ? "is-active" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        履歴
      </Link>
    </nav>
  );
};
