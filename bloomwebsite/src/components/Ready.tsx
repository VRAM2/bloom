import "./Welcome.css";
import "./Ready.css";

type ReadyProps = {
  onContinue?: () => void;
};

export default function Ready({ onContinue }: ReadyProps) {
  return (
    <main className="intro intro--ready">
      <div className="intro__photo" />
      <div className="intro__shade" />

      <section className="intro__content">
        <h1 className="intro__title">
          Все <span className="intro__accent">готово!</span>
        </h1>

        <p className="intro__text">
          Мы подобрали оптимальные условия для его здорового роста и развития.
        </p>

        <button className="intro__button" type="button" onClick={onContinue}>
          Перейти к оранжерее
        </button>
      </section>
    </main>
  );
}