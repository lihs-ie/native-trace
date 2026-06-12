import type { ReactNode } from "react";
import { AppTop } from "./AppTop";

export type AppBarProps = {
  crumb?: ReactNode;
  action?: ReactNode;
};

export const AppBar = ({ crumb, action }: AppBarProps) => (
  <div className="app-top">
    <AppTop />
    {crumb && <div className="crumb">{crumb}</div>}
    {action}
  </div>
);
