import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import BeltActuatorPage from "./BeltActuatorPage.jsx";
import CustomizerPage from "./CustomizerPage.jsx";
import DashboardPage from "./DashboardPage.jsx";
import TractionWheelPage from "./TractionWheelPage.jsx";
import "./styles.css";

const customizer = window.BeltCustomizer;

function currentRoute() {
  return customizer.parseRoute(window.location.hash);
}

function App() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/dashboard");
      setRoute(currentRoute());
    }

    const handleHashChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  if (route.name === customizer.ROUTES.beltActuator) {
    return <BeltActuatorPage />;
  }

  if (route.name === customizer.ROUTES.tractionWheel) {
    return <TractionWheelPage />;
  }

  if (route.name === customizer.ROUTES.pulleyCustomizer) {
    return <CustomizerPage query={route.query} />;
  }

  return <DashboardPage />;
}

createRoot(document.getElementById("root")).render(<App />);
