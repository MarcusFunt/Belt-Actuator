import React from "react";

export default function DashboardPage() {
  return (
    <main className="app-shell page-shell">
      <header className="topbar">
        <div>
          <h1>Dashboard</h1>
          <p>Project tools and generators</p>
        </div>
      </header>

      <section className="dashboard-page" aria-label="Projects">
        <a id="beltActuatorProject" className="project-card" href="#/belt-actuator">
          <span className="project-card-kicker">Project</span>
          <strong>Belt Actuator</strong>
          <span>
            Open the belt layout solver, export Fusion parameters, and generate pulley 3D files.
          </span>
        </a>
      </section>
    </main>
  );
}
