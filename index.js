require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

function getRemindMessage(hour) {
    if (hour === 11) return "좋은 아침이에요! 오늘도 잊지 말고 출근 도장 꾹 눌러주세요? ✨";
    if (hour === 14) return "벌써 오후 2시에요! 설마 오늘 출근 까먹으신 건 아니죠...? 얼른 오세요! 🤨";
    if (hour === 17) return "이제 해가 지려고 해요... 오늘 출근 안 하시면 연속 기록이 깨질지도 몰라요. 제발 와주세요. 😭";
    if (hour === 18) return "저기요... 아직도 안 오신 건가요? 6시예요. 이제 슬슬 걱정되기 시작하네요. 😟";
    if (hour === 19) return "7시입니다. 당신의 연속 출근 기록이 공중분해 되기 직전이에요. 지금 당장 오세요! ⚡";
    if (hour === 20) return "8시... 이제 제 목소리가 들리지 않나요? 당신의 성실함이 시험받고 있어요. ✊";
    if (hour === 21) return "9시예요. 이대로 포기하실 건가요? 지금까지 쌓아온 노력이 아깝지 않으세요? 😠";
    if (hour === 22) return "10시입니다. 이제 시간이 얼마 없어요. 제발... 마지막 기회일지도 몰라요. 🙏";
    if (hour === 23) return "11시!!! 이제 한 시간 뒤면 모든 게 끝납니다. 죽기 살기로 출근하세요! 빨리!!! 🚨🚨";
    return null;
}

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);

    cron.schedule('0 * * * *', async () => {
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const today = kstDate.toISOString().split('T')[0];
        const currentHour = kstDate.getUTCHours();

        const messageText = getRemindMessage(currentHour);
        
        if (messageText) {
            const { data: allUsers } = await supabase.from('attendance').select('*');
            if (allUsers) {
                for (const user of allUsers) {
                    if (user.last_checkin !== today) {
                        try {
                            const discordUser = await client.users.fetch(user.user_id);
                            await discordUser.send(`🔔 <@${user.user_id}>님! ${messageText}`);
                        } catch (err) { console.error(`${user.username} DM 전송 실패`); }
                    }
                }
            }
        }
    });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const now = new Date();
    const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const today = kstDate.toISOString().split('T')[0];
    const currentHour = kstDate.getUTCHours();

    // 듀오링고 테스트 로직 (윤호가 요청한 대로 분리)
    if (message.content === "듀오링고") {
        const testMsg = getRemindMessage(currentHour);
        const finalMsg = testMsg ? testMsg : `현재 한국 시간 ${currentHour}시입니다. (정기 알림 대기 중)`;

        try {
            // 1. 개인 DM으로는 시간에 맞는 멘트를 보냄
            await message.author.send(`🧪 **[테스트 알림]**\n🔔 <@${userId}>님! ${finalMsg}`);
            
            // 2. 채널 답장으로는 깔끔하게 성공 메시지만 보냄
            return message.reply("성공! 개인 DM을 확인해보세요. 📩");
        } catch (err) {
            return message.reply("DM 전송에 실패했습니다. 설정을 확인해 보세요!");
        }
    }

    if (message.content !== "출근" && message.content !== "근출" && message.content !== "출" && message.content !== "근" && message.content !== "出勤" && message.content !== "ㅊㄱ" && message.content !== "출첵" && message.content !== "출석" && message.content !== "attend" && message.content !== "근." && message.content !== "출." && message.content !== "출 " && message.content !== "근 " && message.content !== "출군" && message.content !== "앙" && message.content !== "아잉" && message.content !== "웅" && message.content !== "출근해떠염") return;

    if (currentHour >= 0 && currentHour < 4) {
        return message.reply("🚫 **지금은 출근 금지 시간입니다!**\n상쾌한 아침 공기를 마시며 다시 와주세요! 😴");
    }

    try {
        const { data: user, error: selectError } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (selectError) throw selectError;

        if (user && user.last_checkin === today) {
            return message.reply(`이미 오늘 출근하셨어요! ✨\n(오늘 날짜: ${today})`);
        }

        let newStreak = 1;
        if (user && user.last_checkin) {
            const yesterday = new Date(kstDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (user.last_checkin === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        const { error: upsertError } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                username: message.author.username,
                last_checkin: today,
                streak: newStreak
            }, { onConflict: 'user_id' });

        if (upsertError) throw upsertError;
        message.reply(`✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥`);

    } catch (err) {
        console.error(err);
        message.reply("⚠️ DB 처리 오류 발생!");
    }
});

client.login(process.env.DISCORD_TOKEN);
