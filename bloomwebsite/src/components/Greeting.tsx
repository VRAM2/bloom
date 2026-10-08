import { useEffect, useRef } from "react";
import "./Greeting.css";
import privet from "../assets/privet.svg";

type GreetingProps = {
  onDone: () => void;
};

export default function Greeting({ onDone }: GreetingProps) {
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleAnimationEnd = (e: React.AnimationEvent<HTMLImageElement>) => {
    if (e.animationName !== "helloWrite") return;
    timer.current = window.setTimeout(onDone, 1000);
  };

  return (
    <main className="welcome">
      <div className="welcome__background" />
      <div className="welcome__dark" />
      <div className="welcome__content">
        <img
          className="welcome__hello"
          src={privet}
          alt="Привет"
          onAnimationEnd={handleAnimationEnd}
        />
      </div>
    </main>
  );
}