import Image from "next/image";
import { ArrowRight, Check } from "@phosphor-icons/react/ssr";
import { buttonClass, panelClass } from "@apotek/ui";
import { PILOT_CONTACT_HREF, type Copy } from "@/content/copy";
import pharmacistCustomer from "@/assets/photos/pharmacist-customer.jpg";
import { Reveal } from "./Reveal";
import { Container, Eyebrow } from "./ui";

/** Wide panel: a pharmacist at the counter beside the offer. */
export function Pilot({ copy }: { copy: Copy }) {
  const { pilot } = copy;
  const lists = [
    { title: pilot.getTitle, items: pilot.get, Icon: Check },
    { title: pilot.askTitle, items: pilot.ask, Icon: ArrowRight },
  ];
  return (
    <section id="pilot" className="pb-20 md:pb-28">
      <Container>
        <Reveal className={`${panelClass()} grid overflow-hidden lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}>
          <div className="relative aspect-[4/3] bg-sunk md:aspect-video lg:aspect-auto">
            <Image
              src={pharmacistCustomer}
              alt={pilot.photoAlt}
              fill
              sizes="(min-width: 1024px) 500px, 100vw"
              placeholder="blur"
              className="object-cover object-[60%_30%]"
            />
          </div>
          <div className="px-[22px] pb-8 pt-7 md:p-14">
            <Eyebrow>{pilot.eyebrow}</Eyebrow>
            <h2 className="text-title text-balance">{pilot.title}</h2>
            <p className="mt-4 text-lead text-pretty text-muted">{pilot.body}</p>
            <div className="mt-9 grid gap-6 border-t border-line pt-7 md:grid-cols-2 md:gap-8">
              {lists.map(({ title, items, Icon }) => (
                <div key={title}>
                  <h3 className="font-semibold">{title}</h3>
                  <ul className="mt-3 grid gap-2.5">
                    {items.map((entry) => (
                      <li key={entry} className="flex gap-2.5 text-[0.96rem] leading-snug">
                        <Icon aria-hidden className="mt-px size-[18px] shrink-0 text-accent" />
                        {entry}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <a className={`${buttonClass()} mt-9 w-full md:w-auto`} href={PILOT_CONTACT_HREF}>
              {pilot.cta}
            </a>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
