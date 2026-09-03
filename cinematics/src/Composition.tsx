import { Composition } from "remotion";
import { ThroneRise } from "./ThroneRise";

export const MyComposition = () => {
  return (
    <Composition
      id="ThroneRise"
      component={ThroneRise}
      durationInFrames={300}
      fps={30}
      width={1440}
      height={810}
    />
  );
};
