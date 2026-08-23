"use client";

/**
 * Structured Malaysian address form: address line, postcode, state, area.
 * Typing a known 5-digit postcode auto-fills state and area (suggestion
 * only — both stay editable). Area options are shortlisted by the chosen
 * state via the vendored postcode dataset.
 */

import {
  areasForState,
  lookupPostcode,
  statesList,
} from "@/lib/malaysia-postcodes";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AddressValue = {
  addressLine: string;
  postcode: string;
  state: string;
  area: string;
};

type AddressFieldsProps = {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  disabled?: boolean;
  /**
   * Prefix for the field element ids. Needed because the manual order screen
   * renders two address blocks at once (the order's delivery section and the
   * inline new-customer form); duplicate ids would break label association.
   */
  idPrefix?: string;
  /**
   * Whether the address line and postcode are required to submit the
   * enclosing form. Defaults to true (buyer checkout always needs a
   * deliverable address); the seller's customer dialog passes false since
   * the whole address block is optional there.
   */
  required?: boolean;
};

export function AddressFields({
  value,
  onChange,
  disabled,
  idPrefix = "address",
  required = true,
}: AddressFieldsProps) {
  const ids = {
    line: `${idPrefix}-line`,
    postcode: `${idPrefix}-postcode`,
    state: `${idPrefix}-state`,
    area: `${idPrefix}-area`,
  };
  const areas = value.state ? areasForState(value.state) : [];

  const handlePostcode = (raw: string) => {
    const postcode = raw.replace(/\D/g, "").slice(0, 5);
    const hit = postcode.length === 5 ? lookupPostcode(postcode) : null;
    onChange(
      hit
        ? { ...value, postcode, state: hit.state, area: hit.area }
        : { ...value, postcode },
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={ids.line}>Address</Label>
        <Textarea
          id={ids.line}
          placeholder="House no, street, taman/apartment"
          value={value.addressLine}
          onChange={(e) => onChange({ ...value, addressLine: e.target.value })}
          rows={3}
          maxLength={440}
          disabled={disabled}
          required={required}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={ids.postcode}>Postcode</Label>
          <Input
            id={ids.postcode}
            placeholder="e.g. 80000"
            value={value.postcode}
            onChange={(e) => handlePostcode(e.target.value)}
            inputMode="numeric"
            maxLength={5}
            disabled={disabled}
            required={required}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={ids.state}>State</Label>
          <Select
            value={value.state}
            onValueChange={(state) => {
              // Radix Select can emit a spurious "" when it flips from
              // disabled to enabled with its items not yet mounted; a
              // genuine user pick is never "" since every SelectItem has a
              // non-empty value. Guard so that emission can't clobber state.
              if (state) onChange({ ...value, state, area: "" });
            }}
            disabled={disabled}
          >
            <SelectTrigger id={ids.state} className="w-full">
              <SelectValue placeholder="Select state" />
            </SelectTrigger>
            <SelectContent>
              {statesList().map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={ids.area}>Area</Label>
        <Select
          value={value.area}
          onValueChange={(area) => {
            // Same Radix quirk as the State select above: this Select flips
            // from disabled to enabled in the same update that auto-fills
            // area (postcode lookup), and its SelectContent items aren't
            // mounted yet — it immediately self-fires onValueChange("").
            // Ignore that spurious "" so it can't wipe the auto-filled area;
            // a genuine pick is never "" since every SelectItem has a
            // non-empty value.
            if (area) onChange({ ...value, area });
          }}
          disabled={disabled || !value.state}
        >
          <SelectTrigger id={ids.area} className="w-full">
            <SelectValue
              placeholder={value.state ? "Select area" : "Pick a state first"}
            />
          </SelectTrigger>
          <SelectContent>
            {areas.map((area) => (
              <SelectItem key={area} value={area}>
                {area}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
