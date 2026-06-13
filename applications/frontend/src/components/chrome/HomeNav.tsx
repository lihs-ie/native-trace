import Link from "next/link";

type HomeNavProps = {
  active: "library" | "history" | "diagnostic" | "progress";
};

export const HomeNav = ({ active }: HomeNavProps) => {
  return (
    <nav className="home-nav">
      <Link href="/" className={active === "library" ? "is-active" : ""}>
        ライブラリ
      </Link>
      <Link href="/history" className={active === "history" ? "is-active" : ""}>
        履歴
      </Link>
      <Link href="/progress" className={active === "progress" ? "is-active" : ""}>
        進捗
      </Link>
    </nav>
  );
};
