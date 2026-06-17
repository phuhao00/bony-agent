"use client";

interface ImageEditVariantPickerProps {
  urls: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export default function ImageEditVariantPicker({
  urls,
  selectedIndex,
  onSelect,
}: ImageEditVariantPickerProps) {
  if (urls.length <= 1) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[color:var(--foreground)]">
        生成了 {urls.length} 张结果，点击选择
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {urls.map((url, index) => (
          <button
            key={url}
            type="button"
            onClick={() => onSelect(index)}
            className={`overflow-hidden rounded-lg border-2 transition-all ${
              selectedIndex === index
                ? "border-blue-500 shadow-md"
                : "border-[color:var(--separator-subtle)] hover:border-blue-300"
            }`}
          >
            <img src={url} alt={`结果 ${index + 1}`} className="aspect-square w-full object-cover" />
            <span className="block py-1 text-center text-[10px] text-[color:var(--label-secondary)]">
              #{index + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
