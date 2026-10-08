import "./Welcome.css";

type WelcomeProps = {
  onContinue?: () => void;
};

export default function Welcome({ onContinue }: WelcomeProps) {
  return (
    <main className="intro">
      <div className="intro__photo" />
      <div className="intro__shade" />

      <section className="intro__content">
        <h1 className="intro__title">
          <span>Я твоя</span>
          <span className="intro__accent">оранжерея</span>
        </h1>

        <p className="intro__text">
          Давай познакомимся, чтобы я знала как заботиться о твоем растении.
        </p>

        <button className="intro__button" type="button" onClick={onContinue}>
          Продолжить
        </button>
      </section>
    </main>
  );
}