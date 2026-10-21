using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Text.RegularExpressions;

namespace Uqa
{
    public static class Avatars
    {
        static string DirectoryPath { get { return Path.Combine(Store.DataDir, "avatars"); } }
        public static bool ValidId(string id) { return id != null && Regex.IsMatch(id, "\\A[a-f0-9]{32}\\z"); }
        public static string FilePath(string id)
        {
            if (!ValidId(id)) throw new GameError("頭像不存在");
            return Path.Combine(DirectoryPath, id + ".png");
        }
        public static bool Exists(string avatar)
        {
            return avatar != null && avatar.StartsWith("upload:") && ValidId(avatar.Substring(7)) && File.Exists(FilePath(avatar.Substring(7)));
        }
        public static string Upload(string data)
        {
            if (data == null || data.Length > 720000) throw new GameError("頭像檔案太大，請重新選擇圖片");
            string prefix;
            if (data.StartsWith("data:image/png;base64,")) prefix = "data:image/png;base64,";
            else if (data.StartsWith("data:image/jpeg;base64,")) prefix = "data:image/jpeg;base64,";
            else throw new GameError("頭像僅接受 PNG 或 JPEG 圖片");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(data.Substring(prefix.Length)); }
            catch (FormatException) { throw new GameError("圖片格式不正確"); }
            if (bytes.Length == 0 || bytes.Length > 512000) throw new GameError("圖片大小不正確");
            // Decode actual pixels and create a fresh PNG. Never store original filenames,
            // SVG, metadata or executable content from the upload.
            try
            {
                using (var input = new MemoryStream(bytes))
                using (var image = Image.FromStream(input, false, true))
                {
                    if (image.RawFormat.Guid != ImageFormat.Png.Guid && image.RawFormat.Guid != ImageFormat.Jpeg.Guid) throw new GameError("頭像僅接受 PNG 或 JPEG 圖片");
                    if (image.Width < 1 || image.Height < 1 || image.Width > 4096 || image.Height > 4096) throw new GameError("圖片尺寸過大");
                    using (var output = new Bitmap(128, 128, PixelFormat.Format32bppArgb))
                    {
                        using (var graphics = Graphics.FromImage(output))
                        {
                            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            var side = Math.Min(image.Width, image.Height);
                            graphics.DrawImage(image, new Rectangle(0, 0, 128, 128), new Rectangle((image.Width - side) / 2, (image.Height - side) / 2, side, side), GraphicsUnit.Pixel);
                        }
                        Directory.CreateDirectory(DirectoryPath);
                        var id = Guid.NewGuid().ToString("N");
                        output.Save(FilePath(id), ImageFormat.Png);
                        return "upload:" + id;
                    }
                }
            }
            catch (ArgumentException) { throw new GameError("無法讀取這張圖片，請改選 PNG 或 JPEG"); }
            catch (OutOfMemoryException) { throw new GameError("圖片格式或尺寸不正確"); }
        }
    }
}
